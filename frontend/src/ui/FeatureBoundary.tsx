import { Component, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
}

/** One boundary per feature: a crash in the transcript list must not remove the answer panel. */
export class FeatureBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Name only: error messages can contain user content.
    console.error(`${this.props.name} crashed`, error.name);
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" className="notice-error">
          The {this.props.name} had a problem. The rest of the page still works.{" "}
          <button
            className="underline"
            onClick={() => this.setState({ failed: false })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
