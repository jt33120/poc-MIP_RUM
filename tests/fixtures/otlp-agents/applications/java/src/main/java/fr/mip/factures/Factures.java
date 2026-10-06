// Application d'essai Java : Spring Boot sous opentelemetry-javaagent.jar.
// Aucune ligne OpenTelemetry ici : tout vient de -javaagent et du socle de variables.
package fr.mip.factures;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@RestController
public class Factures {
  private static final Logger journal = LoggerFactory.getLogger(Factures.class);
  private final HttpClient client = HttpClient.newHttpClient();

  public static void main(String[] args) {
    SpringApplication.run(Factures.class, args);
  }

  @GetMapping("/factures/{id}")
  public String facture(@PathVariable String id) throws Exception {
    client.send(
        HttpRequest.newBuilder(URI.create("http://127.0.0.1:8080/stock/" + id)).build(),
        HttpResponse.BodyHandlers.discarding());
    journal.info("facture lue");
    return "facture " + id;
  }

  @GetMapping("/stock/{id}")
  public String stock(@PathVariable String id) {
    return "stock " + id;
  }

  @PostMapping("/factures/{id}/payer")
  public String payer(@PathVariable String id) {
    throw new IllegalStateException("paiement refusé : facture déjà soldée");
  }
}
