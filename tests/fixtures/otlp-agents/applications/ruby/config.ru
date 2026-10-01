# Application d'essai Ruby : Sinatra sous les gems OpenTelemetry.
require "sinatra/base"
require "net/http"

# L'initialiseur de la doc officielle, et rien d'autre : le socle fait le reste.
require "opentelemetry/sdk"
require "opentelemetry/exporter/otlp"
require "opentelemetry/instrumentation/all"
OpenTelemetry::SDK.configure { |c| c.use_all }
# Sans lui, un SIGTERM perd les spans pas encore exportés (constaté sous rackup + WEBrick).
at_exit { OpenTelemetry.tracer_provider.shutdown }

class Factures < Sinatra::Base
  get "/factures/:id" do
    Net::HTTP.get(URI("http://127.0.0.1:8080/stock/#{params[:id]}"))
    "facture #{params[:id]}"
  end

  get "/stock/:id" do
    "stock #{params[:id]}"
  end

  post "/factures/:id/payer" do
    raise "paiement refusé : facture déjà soldée"
  end
end

run Factures
