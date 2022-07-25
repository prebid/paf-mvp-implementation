const opentelemetry = require("@opentelemetry/sdk-node");
const { Resource } = require("@opentelemetry/resources");
const { SemanticResourceAttributes } = require("@opentelemetry/semantic-conventions");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

//Configuration
const serviceName = "PAF Demo";
const serviceVersion = "0.0.1";
const collectorUrl = "http://localhost:4318/v1/traces";

//Describe service
const serviceDescription =
  Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
    })
  );

//Prepare for traces
//const consoleExporter = new opentelemetry.tracing.ConsoleSpanExporter();
const oltpExporter = new OTLPTraceExporter({
    url: collectorUrl
});

//Prepare metrics
const sdk = new opentelemetry.NodeSDK({
  traceExporter: oltpExporter,
  instrumentations: [getNodeAutoInstrumentations()]
});
sdk.addResource(serviceDescription);
sdk.start()