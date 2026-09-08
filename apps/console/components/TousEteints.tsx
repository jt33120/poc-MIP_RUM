// Écran composé à vide : tous les blocs ont été décochés dans la fenêtre de
// composition. Sans ce mot, la page s'affiche entièrement blanche et se lit
// comme une panne — alors que c'est un choix de l'utilisateur, réversible en
// un clic sur la roue de la sidebar.
export function TousEteints() {
  return (
    <div className="card p-8 text-center">
      <p className="text-sm font-semibold text-ink">Cet écran est vide parce que vous l&apos;avez composé ainsi.</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
        Tous les blocs sont décochés. Rouvrez la roue de réglage, à droite de l&apos;entrée de menu, pour en
        réactiver.
      </p>
    </div>
  );
}
