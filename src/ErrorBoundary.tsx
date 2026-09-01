import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeContent: "center",
            textAlign: "center",
            padding: "32px",
            fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, sans-serif",
            background: "#fbfcfa",
            color: "#18211f",
          }}
        >
          <div
            style={{
              maxWidth: 420,
              background: "#fff",
              borderRadius: 20,
              padding: "40px 28px",
              border: "1px solid #e6ece8",
              boxShadow: "0 4px 20px #172c2310",
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#fff0ed",
                display: "grid",
                placeItems: "center",
                margin: "0 auto 20px",
                fontSize: 28,
              }}
            >
              ⚠️
            </div>
            <h1 style={{ fontSize: 22, margin: "0 0 8px", letterSpacing: -0.5 }}>
              문제가 발생했어요
            </h1>
            <p style={{ fontSize: 14, color: "#68746f", margin: "0 0 24px", lineHeight: 1.6 }}>
              라이드메이트에서 예상하지 못한 오류가 발생했습니다.
              <br />
              페이지를 새로고침하거나 잠시 후 다시 시도해 주세요.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#0d5f4c",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                padding: "12px 28px",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                minHeight: 48,
              }}
            >
              새로고침
            </button>
            {this.state.error && (
              <details
                style={{
                  marginTop: 20,
                  textAlign: "left",
                  fontSize: 11,
                  color: "#8a948f",
                }}
              >
                <summary style={{ cursor: "pointer", padding: "4px 0" }}>
                  기술 정보
                </summary>
                <pre
                  style={{
                    marginTop: 8,
                    padding: 12,
                    background: "#f5f8f6",
                    borderRadius: 8,
                    overflow: "auto",
                    fontSize: 10,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {this.state.error.message}
                  {"\n"}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
