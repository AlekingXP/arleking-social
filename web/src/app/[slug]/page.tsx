import type { Metadata } from "next";
import { notFound } from "next/navigation";
import VipBadge from "@/components/vip/VipBadge";
import { getLinks, getProfile, resolveAssetUrl } from "@/lib/api";

export async function generateMetadata(props: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const profile = await getProfile(slug);
  if (!profile) return { title: "Página no encontrada" };
  return { title: profile.name, description: profile.tagline };
}

export default async function ProfilePage(props: PageProps<"/[slug]">) {
  const { slug } = await props.params;
  const profile = await getProfile(slug);
  if (!profile) notFound();

  const links = await getLinks(slug);
  const avatarSrc = resolveAssetUrl(profile.avatar_path) || placeholderAvatar(profile.name);

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center gap-8 px-6 py-16 text-center"
      style={{
        backgroundImage: `radial-gradient(circle at 50% 0%, ${profile.accent_from}26, transparent 60%)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- avatar is served by a separate Express origin */}
      <img
        src={avatarSrc}
        alt={profile.name}
        className="h-24 w-24 rounded-full object-cover ring-2 ring-white/10"
      />

      <div className="flex flex-col items-center gap-2">
        <h1 className="flex items-center gap-2 font-serif text-2xl font-semibold text-neutral-50">
          <span>{profile.name}</span>
          <VipBadge tier={profile.vip_tier} slug={profile.slug} />
        </h1>
        <p className="text-sm text-neutral-400">{profile.tagline}</p>
      </div>

      <nav className="flex w-full flex-col gap-3">
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
          >
            <span className="text-xl">{link.icon || "🔗"}</span>
            <span className="flex-1">
              <span className="block text-sm font-medium text-neutral-100">{link.label}</span>
              {link.subtitle && (
                <span className="block text-xs text-neutral-400">{link.subtitle}</span>
              )}
            </span>
            <span className="text-neutral-500">→</span>
          </a>
        ))}
      </nav>

      <footer className="pt-8 text-xs text-neutral-500">{profile.footer_text || profile.name}</footer>
    </main>
  );
}

function placeholderAvatar(name: string) {
  const letter = (name || "?").charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#2a1420"/><text x="50%" y="54%" font-family="sans-serif" font-size="80" fill="#f5eef0" text-anchor="middle" dominant-baseline="middle">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
