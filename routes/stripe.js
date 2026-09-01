const express = require('express');
const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { uploadsDir } = require('../paths');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// STRIPE_SECRET_KEY isn't set until deploy time — degrade to a clear 503
// instead of crashing the whole process on a missing env var.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const PRICE_IDS = {
  billete: process.env.STRIPE_PRICE_BILLETE,
  king: process.env.STRIPE_PRICE_KING,
};

// Payment endpoints hit the Stripe API on every call, so they're rate
// limited per-IP independently of the auth limiter — an authenticated
// account shouldn't be able to spray Checkout Sessions.
const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de pago. Espera unos minutos.' },
});

function requireStripeConfigured(req, res, next) {
  if (!stripe) return res.status(503).json({ error: 'Los pagos todavía no están configurados en el servidor.' });
  next();
}

function originUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ---- Checkout: start a subscription for the logged-in platform user ----

router.post('/checkout', paymentLimiter, requireAuth, requireStripeConfigured, async (req, res) => {
  const { tier } = req.body || {};
  const priceId = PRICE_IDS[tier];
  if (!priceId) return res.status(400).json({ error: 'Tier VIP inválido' });

  const profile = db.prepare('SELECT * FROM profile WHERE user_id = ?').get(req.session.userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!profile || !user) return res.status(404).json({ error: 'Perfil no encontrado' });

  // Guard against double-billing: without this, a user with a live
  // subscription could start a second Checkout and end up paying twice.
  // Stripe is asked for the authoritative status rather than trusting our
  // own column, which can lag behind a webhook.
  if (profile.stripe_subscription_id) {
    try {
      const existing = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
      if (['active', 'trialing', 'past_due', 'unpaid'].includes(existing.status)) {
        return res.status(409).json({
          error: 'Ya tienes una suscripción activa. Usa "Gestionar suscripción" para cambiarla o cancelarla.',
        });
      }
    } catch (err) {
      // Subscription is gone from Stripe (deleted/never existed) — fall
      // through and let them subscribe again.
      console.warn('No se pudo verificar la suscripción existente:', err.message);
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(req.session.userId),
      customer: profile.stripe_customer_id || undefined,
      customer_email: profile.stripe_customer_id ? undefined : (user.google_email || undefined),
      metadata: { user_id: String(req.session.userId), tier },
      subscription_data: { metadata: { user_id: String(req.session.userId), tier } },
      success_url: `${originUrl(req)}/admin/dashboard?checkout=success`,
      cancel_url: `${originUrl(req)}/admin/dashboard?checkout=cancel`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creando Checkout Session:', err.message);
    res.status(500).json({ error: 'No se pudo iniciar el pago. Intenta de nuevo.' });
  }
});

// ---- Billing Portal: self-serve cancel / update payment method ----

// The portal refuses to open until the account has a configuration, and
// that can't be created from a restricted key — so the app creates its own
// on first use instead of depending on someone clicking through the Stripe
// Dashboard. Cached per process; `null` means "not resolved yet".
let portalConfigurationId = null;

async function ensurePortalConfiguration(req) {
  if (portalConfigurationId) return portalConfigurationId;

  const existing = await stripe.billingPortal.configurations.list({ limit: 1, active: true });
  if (existing.data.length) {
    portalConfigurationId = existing.data[0].id;
    return portalConfigurationId;
  }

  const origin = originUrl(req);
  const created = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: 'ArleKing Social — gestiona tu suscripción VIP',
      privacy_policy_url: `${origin}/privacidad`,
      terms_of_service_url: `${origin}/terminos`,
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'missing_features', 'unused', 'other'],
        },
      },
    },
  });
  portalConfigurationId = created.id;
  return portalConfigurationId;
}

router.post('/billing-portal', paymentLimiter, requireAuth, requireStripeConfigured, async (req, res) => {
  const profile = db.prepare('SELECT stripe_customer_id FROM profile WHERE user_id = ?').get(req.session.userId);
  if (!profile || !profile.stripe_customer_id) {
    return res.status(400).json({ error: 'Todavía no tienes una suscripción activa.' });
  }

  try {
    const configuration = await ensurePortalConfiguration(req);
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      configuration,
      return_url: `${originUrl(req)}/admin/dashboard`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creando sesión del portal de facturación:', err.message);
    res.status(500).json({ error: 'No se pudo abrir el portal de facturación.' });
  }
});

// ---- Account deletion ----
// Lives here rather than in admin.js because the subscription has to be
// cancelled at Stripe first: deleting the row locally would leave the
// customer being charged every month for a page that no longer exists,
// with no account left to cancel it from.

router.post('/account/delete', paymentLimiter, requireAuth, async (req, res) => {
  const { confirm } = req.body || {};
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Cuenta no encontrada' });

  // Typed confirmation, compared exactly — this is irreversible.
  if (confirm !== user.username) {
    return res.status(400).json({ error: 'Escribe tu nombre de usuario exactamente para confirmar.' });
  }

  const profile = db
    .prepare('SELECT slug, avatar_path, background_path, stripe_subscription_id FROM profile WHERE user_id = ?')
    .get(user.id);

  // Cancel first. If Stripe is unreachable we stop here instead of deleting
  // the account and orphaning a live subscription.
  if (profile && profile.stripe_subscription_id) {
    if (!stripe) {
      return res.status(503).json({
        error: 'Tienes una suscripción activa y los pagos no están configurados en el servidor. Cancélala antes de borrar la cuenta.',
      });
    }
    try {
      await stripe.subscriptions.cancel(profile.stripe_subscription_id);
    } catch (err) {
      // Already gone at Stripe's end is fine — anything else is not.
      const missing = err && (err.code === 'resource_missing' || err.statusCode === 404);
      if (!missing) {
        console.error('No se pudo cancelar la suscripción antes de borrar la cuenta:', err.message);
        return res.status(502).json({
          error: 'No se pudo cancelar tu suscripción en Stripe, así que no se borró nada. Inténtalo de nuevo en unos minutos.',
        });
      }
    }
  }

  const images = db.prepare('SELECT image_path FROM links WHERE user_id = ?').all(user.id).map((r) => r.image_path);
  if (profile) images.push(profile.avatar_path, profile.background_path);

  // profile, links and oauth_accounts all cascade off users.
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);

  // Uploads live on disk, outside the cascade — clean them up afterwards so
  // a failed unlink can't roll back an already-committed delete.
  for (const image of images) {
    if (image) fs.unlink(path.join(uploadsDir, path.basename(image)), () => {});
  }

  req.session.destroy(() => res.json({ ok: true }));
});

// ---- Webhook: source of truth for activating/revoking the badge ----
// Mounted separately in server.js with express.raw() BEFORE express.json(),
// since signature verification needs the exact raw request body.

const markEventSeen = db.prepare('INSERT INTO stripe_events (id, type) VALUES (?, ?)');

async function webhookHandler(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Webhook not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Firma de webhook de Stripe inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Replay guard. The PRIMARY KEY does the deduping atomically, so a
  // duplicate delivery throws here and is acknowledged without re-running
  // any state change.
  try {
    markEventSeen.run(event.id, event.type);
  } catch {
    return res.json({ received: true, duplicate: true });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      // Only grant on a session that actually completed and was paid for
      // (`no_payment_required` covers a 100%-off coupon or trial).
      const paid = session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
      const userId = Number(session.client_reference_id || (session.metadata && session.metadata.user_id));
      const tier = session.metadata && session.metadata.tier;

      if (paid && userId && tier) {
        db.prepare(`
          UPDATE profile SET
            vip_tier = ?, vip_activated_at = datetime('now'),
            stripe_customer_id = ?, stripe_subscription_id = ?
          WHERE user_id = ?
        `).run(tier, session.customer, session.subscription, userId);
      }
    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const active = sub.status === 'active' || sub.status === 'trialing';
      if (!active) {
        db.prepare('UPDATE profile SET vip_tier = NULL WHERE stripe_subscription_id = ?').run(sub.id);
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      db.prepare('UPDATE profile SET vip_tier = NULL WHERE stripe_subscription_id = ?').run(sub.id);
    }
  } catch (err) {
    // Returning 200 here would tell Stripe the event was handled and it
    // would never retry — leaving someone who paid without their badge.
    // Roll back the replay guard so the retry is allowed to run.
    console.error('Error procesando evento de Stripe:', event.type, err.message);
    try {
      db.prepare('DELETE FROM stripe_events WHERE id = ?').run(event.id);
    } catch {
      // Best effort — a stuck row only costs us one skipped retry.
    }
    return res.status(500).json({ error: 'Error procesando el evento' });
  }

  res.json({ received: true });
}

module.exports = { router, webhookHandler };
