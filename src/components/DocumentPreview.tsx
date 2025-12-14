import { useState } from "react";
import type { TypstOutput } from "../types";

interface DocumentPreviewProps {
  output: TypstOutput | null;
}

export function DocumentPreview({ output }: DocumentPreviewProps) {
  const [showCode, setShowCode] = useState(false);
  const [zoom, setZoom] = useState(100);

  const downloadPdf = () => {
    if (!output?.pdfUrl) return;

    const link = document.createElement("a");
    link.href = output.pdfUrl;
    link.download = "document.pdf";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyCode = async () => {
    if (!output?.code) return;
    await navigator.clipboard.writeText(output.code);
  };

  const zoomIn = () => setZoom((z) => Math.min(z + 25, 200));
  const zoomOut = () => setZoom((z) => Math.max(z - 25, 50));
  const resetZoom = () => setZoom(100);

  if (!output) {
    return (
      <div className="document-preview empty">
        <div className="empty-state">
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <p>Your document preview will appear here</p>
        </div>
      </div>
    );
  }

  if (output.error) {
    return (
      <div className="document-preview error">
        <div className="error-state">
          <h3>Rendering Error</h3>
          <pre>{output.error}</pre>
          {output.code && (
            <div className="code-section">
              <h4>Typst Code:</h4>
              <pre className="typst-code">{output.code}</pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  const pageCount = output.pages?.length || 0;

  return (
    <div className="document-preview">
      <div className="preview-toolbar">
        <div className="toolbar-tabs">
          <button
            className={!showCode ? "active" : ""}
            onClick={() => setShowCode(false)}
          >
            Preview
          </button>
          <button
            className={showCode ? "active" : ""}
            onClick={() => setShowCode(true)}
          >
            Code
          </button>
        </div>

        {!showCode && pageCount > 0 && (
          <div className="zoom-controls">
            <button onClick={zoomOut} className="zoom-btn" title="Zoom out">
              −
            </button>
            <button onClick={resetZoom} className="zoom-label">
              {zoom}%
            </button>
            <button onClick={zoomIn} className="zoom-btn" title="Zoom in">
              +
            </button>
            <span className="page-count">
              {pageCount} page{pageCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        <div className="toolbar-actions">
          {showCode && (
            <button onClick={copyCode} className="action-btn">
              Copy Code
            </button>
          )}
          {output.pdfUrl && (
            <button onClick={downloadPdf} className="action-btn primary">
              Download PDF
            </button>
          )}
        </div>
      </div>

      <div className="preview-content">
        {showCode ? (
          <pre className="typst-code">{output.code}</pre>
        ) : (
          <div className="pdf-viewer">
            <div
              className="pages-container"
              style={{ "--zoom": zoom / 100 } as React.CSSProperties}
            >
              {output.pages?.map((pageUrl, index) => (
                <div key={index} className="page-wrapper">
                  <div className="page-number">Page {index + 1}</div>
                  <div className="page">
                    <img src={pageUrl} alt={`Page ${index + 1}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
