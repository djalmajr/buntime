import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Icon } from "./ui/icon";
import { ScrollArea } from "./ui/scroll-area";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, resetError: () => void) => ReactNode;
  labels?: {
    errorDetails?: string;
    errorOccurred?: string;
    reloadPage?: string;
    somethingWrong?: string;
    stackTrace?: string;
    tryAgain?: string;
    tryRefreshing?: string;
  };
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  error: Error | null;
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console in development
    if (this.props.showDetails) {
      console.error("Error caught by ErrorBoundary:", error, errorInfo);
    }
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  override render() {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.resetError);
      }

      const showDetails = this.props.showDetails ?? false;

      // Default labels with English fallbacks
      const labels = {
        errorDetails: this.props.labels?.errorDetails ?? "Error details:",
        errorOccurred:
          this.props.labels?.errorOccurred ?? "An error occurred while rendering this component",
        reloadPage: this.props.labels?.reloadPage ?? "Reload Page",
        somethingWrong: this.props.labels?.somethingWrong ?? "Something went wrong",
        stackTrace: this.props.labels?.stackTrace ?? "Stack trace:",
        tryAgain: this.props.labels?.tryAgain ?? "Try Again",
        tryRefreshing:
          this.props.labels?.tryRefreshing ??
          "Please try refreshing the page. If the problem persists, contact support.",
      };

      // Default error UI
      return (
        <div className="flex items-center justify-center min-h-[400px] p-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-destructive/10">
                  <Icon className="size-6 text-destructive" icon="lucide:alert-triangle" />
                </div>
                <div>
                  <CardTitle>{labels.somethingWrong}</CardTitle>
                  <CardDescription>{labels.errorOccurred}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {showDetails && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">{labels.errorDetails}</p>
                  <ScrollArea className="max-h-[200px]">
                    <pre className="p-3 rounded-md bg-muted text-sm">
                      <code>{this.state.error.message}</code>
                    </pre>
                  </ScrollArea>
                  {this.state.error.stack && (
                    <>
                      <p className="text-sm font-medium">{labels.stackTrace}</p>
                      <ScrollArea className="max-h-[200px]">
                        <pre className="p-3 rounded-md bg-muted text-xs">
                          <code>{this.state.error.stack}</code>
                        </pre>
                      </ScrollArea>
                    </>
                  )}
                </div>
              )}
              {!showDetails && (
                <p className="text-muted-foreground text-sm">{labels.tryRefreshing}</p>
              )}
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button variant="outline" onClick={this.resetError}>
                <Icon className="mr-2 size-4" icon="lucide:refresh-cw" />
                {labels.tryAgain}
              </Button>
              <Button variant="default" onClick={() => window.location.reload()}>
                {labels.reloadPage}
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
