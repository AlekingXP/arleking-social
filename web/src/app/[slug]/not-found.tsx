export default function ProfileNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center text-neutral-100">
      <h1 className="text-xl font-semibold">Página no encontrada</h1>
      <p className="text-sm text-neutral-500">Este usuario no existe o cambió de dirección.</p>
    </main>
  );
}
