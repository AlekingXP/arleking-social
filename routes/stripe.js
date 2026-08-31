const express = require('express');
const Stripe = require('stripe');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// STRIPE_SECRET_KEY isn't set until deploy time — degrade to a clear 503
// instead of crashing the whole process on a missing env var.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const PRICE_IDS = {
  billete: process.env.STRIPE_PRICE_BILLETE,
  king: process.env.STRIPE_PRICE_KING,
};

function requireStripeConfigured(req, res, next) {
  if (!stripe) return res.status(503).json({ error: 'Los pagos todavía no están configurados en el servidor.' });
  next();
}

function originUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ---- Checkout: start a subscription for the logged-in platform user ----

router.post('/checkout', requireAuth, requireStripeConfigured, async (req, res) => {
  const { tier } = req.body || {};
  const priceId = PRICE_IDS[tier];
  if (!priceId) return res.status(400).json({ error: 'Tier VIP inválido' });

  const profile = db.prepare('SELECT * FROM profile WHERE user_id = ?').get(req.session.userId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);

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

router.post('/billing-portal', requireAuth, requireStripeConfigured, async (req, res) => {
  const profile = db.prepare('SELECT stripe_customer_id FROM profile WHERE user_id = ?').get(req.session.userId);
  if (!profile || !profile.stripe_customer_id) {
    return res.status(400).json({ error: 'Todavía no tienes una suscripción activa.' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${originUrl(req)}/admin/dashboard`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creando sesión del portal de facturación:', err.message);
    res.status(500).json({ error: 'No se pudo abrir el portal de facturación.' });
  }
});

// ---- Webhook: source of truth for activating/revoking the badge ----
// Mounted separately in server.js with express.raw() BEFORE express.json(),
// since signature verification needs the exact raw request body.
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

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = Number(session.client_reference_id || (session.metadata && session.metadata.user_id));
      const tier = session.metadata && session.metadata.tier;
      if (userId && tier) {
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
    console.error('Error procesando evento de Stripe:', event.type, err.message);
  }

  res.json({ received: true });
}

module.exports = { router, webhookHandler };
