# Application d'essai Java sous l'agent OpenTelemetry officiel, version et empreinte
# figées. Construite et lancée par ../../capturer.mjs, jamais par un service du dépôt.
FROM maven:3.9-eclipse-temurin-21 AS construction
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:21-jre
# L'empreinte est celle que GitHub publie avec la release (champ `digest` de l'asset) :
# un jar qui ne la porte pas arrête la construction.
ARG OTEL_JAVAAGENT_VERSION=2.31.1
ARG OTEL_JAVAAGENT_SHA256=bbf83c151b6400709e2f225bdd07a04f839d9d13b8b93464241333fd25d3e3ba
WORKDIR /app
RUN curl -sSfLo opentelemetry-javaagent.jar \
      "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_JAVAAGENT_VERSION}/opentelemetry-javaagent.jar" \
 && echo "${OTEL_JAVAAGENT_SHA256}  opentelemetry-javaagent.jar" | sha256sum -c -
COPY --from=construction /src/target/app.jar app.jar
EXPOSE 8080
# -javaagent AVANT -jar : placé après, ce serait un argument de l'application.
ENTRYPOINT ["java", "-javaagent:/app/opentelemetry-javaagent.jar", "-jar", "/app/app.jar"]
