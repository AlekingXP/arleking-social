export default function Home() {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-neutral-100">
      <h1 className="text-xl font-semibold">ArleKing Social</h1>
      <p className="max-w-sm text-sm text-neutral-500">
        Este es el nuevo frontend en Next.js de las páginas de perfil. Visita{" "}
        <code className="rounded bg-white/10 px-1.5 py-0.5">/tu-slug</code> para ver un perfil.
      </p>
    </main>
  );
}
