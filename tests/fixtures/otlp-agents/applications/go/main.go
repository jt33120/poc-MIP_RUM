// Application d'essai Go : SDK OpenTelemetry + otelhttp + exportateur OTLP/HTTP.
// Configuration : les seules variables du socle (la fiche des capteurs serveur § 1).
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

func main() {
	ctx := context.Background()
	exp, err := otlptracehttp.New(ctx)
	if err != nil {
		log.Fatal(err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp))
	otel.SetTracerProvider(tp)
	if os.Getenv("ESSAI_SANS_PROPAGATEUR") == "" {
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	}

	client := &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /factures/{id}", func(w http.ResponseWriter, r *http.Request) {
		req, _ := http.NewRequestWithContext(r.Context(), "GET", "http://127.0.0.1:8080/stock/"+r.PathValue("id"), nil)
		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, err.Error(), 502)
			return
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		fmt.Fprintf(w, "facture %s\n", r.PathValue("id"))
	})
	mux.HandleFunc("GET /stock/{id}", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "stock %s\n", r.PathValue("id"))
	})
	mux.HandleFunc("POST /factures/{id}/payer", func(w http.ResponseWriter, r *http.Request) {
		err := errors.New("paiement refusé : facture déjà soldée")
		span := trace.SpanFromContext(r.Context())
		span.RecordError(err, trace.WithStackTrace(true))
		span.SetStatus(codes.Error, err.Error())
		http.Error(w, "erreur interne", 500)
	})

	srv := &http.Server{Addr: ":8080", Handler: otelhttp.NewHandler(mux, "serveur")}
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	log.Println("à l'écoute sur :8080")
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	<-stop
	c, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	srv.Shutdown(c)
	if err := tp.Shutdown(c); err != nil {
		log.Println("arrêt du TracerProvider :", err)
	}
	log.Println("arrêté")
}
