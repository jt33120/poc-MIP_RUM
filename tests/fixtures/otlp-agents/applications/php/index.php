<?php
// Application d'essai PHP : Slim 4, sous l'extension opentelemetry et l'auto-instrumentation.
// Aucune ligne OpenTelemetry ici : tout vient du socle et de OTEL_PHP_AUTOLOAD_ENABLED.
use Monolog\Handler\StreamHandler;
use Monolog\Logger;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

require __DIR__ . '/vendor/autoload.php';

$journal = new Logger('factures');
$journal->pushHandler(new StreamHandler('php://stderr'));

$app = AppFactory::create();
$app->addRoutingMiddleware();
$app->addErrorMiddleware(false, false, false);

$app->get('/factures/{id}', function (Request $req, Response $res, array $args) use ($journal) {
    $db = new PDO('sqlite::memory:');
    $db->exec('create table facture (id integer primary key, montant integer)');
    $db->exec('insert into facture values (42, 1200)');
    $q = $db->prepare('select montant from facture where id = ?');
    $q->execute([(int) $args['id']]);
    $journal->info('facture lue', ['id' => $args['id']]);
    $res->getBody()->write('facture ' . $args['id'] . ' : ' . $q->fetchColumn());
    return $res;
});

$app->post('/factures/{id}/payer', function (Request $req, Response $res, array $args) use ($journal) {
    try {
        throw new RuntimeException('paiement refusé : facture déjà soldée');
    } catch (RuntimeException $e) {
        $journal->error('paiement en échec', ['exception' => $e]);
        throw $e;
    }
});

$app->run();
