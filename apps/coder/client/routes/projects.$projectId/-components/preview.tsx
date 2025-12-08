import { useCallback, useEffect, useRef, useState } from "react";

interface PreviewProps {
  code: string | null;
  error?: string | null;
}

const PREVIEW_HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">{{CODE}}</script>
</body>
</html>`;

export function Preview({ code, error }: PreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const updatePreview = useCallback((jsCode: string) => {
    const html = PREVIEW_HTML_TEMPLATE.replace("{{CODE}}", jsCode);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);

    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  useEffect(() => {
    if (code) {
      updatePreview(code);
    }
  }, [code, updatePreview]);

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (error) {
    return (
      <div className="flex h-full flex-col bg-red-50 p-4">
        <h3 className="mb-2 font-semibold text-red-700">Build Error</h3>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap font-mono text-sm text-red-600">
          {error}
        </pre>
      </div>
    );
  }

  return (
    <iframe
      className="h-full w-full border-0 bg-white"
      ref={iframeRef}
      sandbox="allow-scripts allow-same-origin"
      src={blobUrl ?? "about:blank"}
      title="Preview"
    />
  );
}
