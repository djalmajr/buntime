{{/*
Expand the name of the chart.
*/}}
{{- define "libsql.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "libsql.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "libsql.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels for primary
*/}}
{{- define "libsql.selectorLabels.primary" -}}
app.kubernetes.io/name: {{ include "libsql.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: primary
{{- end }}

{{/*
Selector labels for replica
*/}}
{{- define "libsql.selectorLabels.replica" -}}
app.kubernetes.io/name: {{ include "libsql.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: replica
{{- end }}
