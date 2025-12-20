{{/*
Expand the name of the chart.
*/}}
{{- define "buntime.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "buntime.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "buntime.labels" -}}
app: {{ include "buntime.name" . }}
app.kubernetes.io/name: {{ include "buntime.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "buntime.selectorLabels" -}}
app: {{ include "buntime.name" . }}
app.kubernetes.io/name: {{ include "buntime.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Return the LibSQL URL
*/}}
{{- define "buntime.libsqlUrl" -}}
{{- if .Values.buntime.libsqlUrl }}
{{- .Values.buntime.libsqlUrl }}
{{- else if .Values.libsql.externalUrl }}
{{- .Values.libsql.externalUrl }}
{{- else }}
{{- "" }}
{{- end }}
{{- end }}
