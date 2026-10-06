# Application d'essai .NET sous l'instrumentation automatique OpenTelemetry .NET,
# version et empreintes figées. Construite et lancée par ../../capturer.mjs, jamais par
# un service du dépôt.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS construction
WORKDIR /src
COPY Factures.csproj Program.cs ./
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
ARG OTEL_DOTNET_AUTO_VERSION=1.17.0
# Empreintes publiées par GitHub avec la release (champ `digest` de chaque asset).
ARG OTEL_DOTNET_AUTO_INSTALL_SHA256=93f4b1b12deb4c58ff4deee02c10280ee45fbb015f6fb012ef06343c797d1672
ARG OTEL_DOTNET_AUTO_ZIP_X64_SHA256=cc56878f0155e28b6554924fbd420fcb8bec7108cd9d41836dc530764ac923f8
ARG OTEL_DOTNET_AUTO_ZIP_ARM64_SHA256=d7dc0d8f6562eb12108eaf896c277e536133259d49545e3e2545be3ea7a14144
ENV OTEL_DOTNET_AUTO_HOME=/otel-dotnet-auto
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*
# Le script officiel vérifie la release avec la CLI GitHub (gh), absente de l'image :
# l'archive est vérifiée ici, par l'empreinte que GitHub publie, puis remise au script
# (LOCAL_PATH) avec SKIP_RELEASE_VERIFICATION=true.
RUN set -eu; \
    case "$(uname -m)" in \
      x86_64) arch=x64; somme="${OTEL_DOTNET_AUTO_ZIP_X64_SHA256}" ;; \
      aarch64) arch=arm64; somme="${OTEL_DOTNET_AUTO_ZIP_ARM64_SHA256}" ;; \
      *) echo "architecture non prévue : $(uname -m)" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/open-telemetry/opentelemetry-dotnet-instrumentation/releases/download/v${OTEL_DOTNET_AUTO_VERSION}"; \
    curl -sSfLo /tmp/otel-dotnet-auto-install.sh "$base/otel-dotnet-auto-install.sh"; \
    echo "${OTEL_DOTNET_AUTO_INSTALL_SHA256}  /tmp/otel-dotnet-auto-install.sh" | sha256sum -c -; \
    curl -sSfLo /tmp/otel-dotnet-auto.zip "$base/opentelemetry-dotnet-instrumentation-linux-glibc-$arch.zip"; \
    echo "$somme  /tmp/otel-dotnet-auto.zip" | sha256sum -c -; \
    LOCAL_PATH=/tmp/otel-dotnet-auto.zip SKIP_RELEASE_VERIFICATION=true sh /tmp/otel-dotnet-auto-install.sh; \
    rm -f /tmp/otel-dotnet-auto-install.sh /tmp/otel-dotnet-auto.zip
WORKDIR /app
COPY --from=construction /app .
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
# instrument.sh se SOURCE dans le shell qui lance l'application : exécuté à part, il ne
# règlerait que son propre processus. `exec` laisse dotnet recevoir le SIGTERM de l'arrêt.
ENTRYPOINT ["bash", "-c", ". \"$OTEL_DOTNET_AUTO_HOME/instrument.sh\" && exec dotnet /app/Factures.dll"]
