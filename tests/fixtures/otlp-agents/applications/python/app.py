# Application d'essai Python : Flask, sous opentelemetry-instrument.
# Aucune ligne OpenTelemetry ici : tout vient de l'agent et du socle de variables.
import logging
from urllib.request import urlopen

from flask import Flask

# Un gestionnaire à soi, au niveau INFO : sans lui, les journaux INFO ne passent pas le
# niveau WARNING du journal racine, et un export refusé ne s'affiche nulle part.
# Posé à la main plutôt que par `basicConfig`, qui ne fait rien quand la racine a déjà
# un gestionnaire (l'agent pose le sien avant d'importer l'application).
racine = logging.getLogger()
racine.setLevel(logging.INFO)
racine.addHandler(logging.StreamHandler())
journal = logging.getLogger("factures")

app = Flask(__name__)


@app.get("/factures/<int:id>")
def facture(id):
    with urlopen(f"http://127.0.0.1:8080/stock/{id}") as reponse:
        reponse.read()
    journal.info("facture lue")
    return f"facture {id}"


@app.get("/stock/<int:id>")
def stock(id):
    return f"stock {id}"


@app.post("/factures/<int:id>/payer")
def payer(id):
    raise RuntimeError("paiement refusé : facture déjà soldée")
