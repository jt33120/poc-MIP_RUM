/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg"],
  // La vitrine date sa capture par le manifeste des captures, lu sur le disque à
  // chaque requête (lib/portail-manifeste.ts). Un fichier de public/ est servi à
  // part, pas embarqué dans la fonction serveur : on l'y ajoute nommément. Absent
  // (avant le passage de scripts/captures-portail.mjs), rien n'est ajouté et la
  // légende reste sans date.
  outputFileTracingIncludes: {
    "/presentation": ["./public/portail/manifest.json"],
  },
};

export default nextConfig;
