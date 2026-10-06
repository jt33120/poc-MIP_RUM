// Application d'essai .NET : ASP.NET Core (API minimale), sous l'instrumentation
// automatique OpenTelemetry .NET. Aucune ligne OpenTelemetry ici : tout vient de
// instrument.sh et du socle de variables.
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpClient();
var app = builder.Build();

app.MapGet("/factures/{id}", async (string id, IHttpClientFactory clients, ILogger<Program> journal) =>
{
    await clients.CreateClient().GetStringAsync($"http://127.0.0.1:8080/stock/{id}");
    journal.LogInformation("facture lue");
    return $"facture {id}";
});

app.MapGet("/stock/{id}", (string id) => $"stock {id}");

app.MapPost("/factures/{id}/payer", (string id) =>
{
    throw new InvalidOperationException("paiement refusé : facture déjà soldée");
});

app.Run();
