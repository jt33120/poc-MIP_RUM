# Application d'essai Python (Flask) sous l'agent OpenTelemetry officiel,
# opentelemetry-instrument, versions figées. Construite et lancée par ../../capturer.mjs,
# jamais par un service du dépôt.
FROM python:3.13-slim
ARG FLASK_VERSION=3.1.3
ARG OTEL_DISTRO_VERSION=0.66b0
ARG OTEL_SDK_VERSION=1.45.0
WORKDIR /app
# L'exportateur HTTP seul : le protocole http/protobuf du socle n'a pas besoin du paquet gRPC.
# `opentelemetry-bootstrap` APRÈS Flask : il n'installe que les instrumentations des
# bibliothèques qu'il trouve, à la version de la distro.
RUN pip install --no-cache-dir \
      "flask==${FLASK_VERSION}" \
      "opentelemetry-distro==${OTEL_DISTRO_VERSION}" \
      "opentelemetry-sdk==${OTEL_SDK_VERSION}" \
      "opentelemetry-exporter-otlp-proto-http==${OTEL_SDK_VERSION}" \
 && opentelemetry-bootstrap -a install \
 && pip freeze > /app/versions.txt
COPY app.py .
EXPOSE 8080
CMD ["opentelemetry-instrument", "flask", "--app", "app", "run", "--host", "0.0.0.0", "--port", "8080"]
