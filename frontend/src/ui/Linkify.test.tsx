import { render, screen } from "@testing-library/react";

import { Linkify } from "./Linkify";

describe("Linkify", () => {
  it("links http, https and www addresses, without the full stop after them", () => {
    render(
      <p>
        <Linkify text="Work: https://justus.dev/work. See www.example.com/a, thanks" />
      </p>,
    );
    const a = screen.getAllByRole("link");
    expect(a[0]).toHaveAttribute("href", "https://justus.dev/work");
    expect(a[0]).toHaveTextContent("https://justus.dev/work");
    expect(a[1]).toHaveAttribute("href", "https://www.example.com/a");
    expect(a[0]).toHaveAttribute("target", "_blank");
    expect(a[0]).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("never links anything but web addresses, and never reads text as HTML", () => {
    render(
      <p>
        <Linkify
          text={'javascript:alert(1) <b>x</b> ftp://a.b "https://ok.io"'}
        />
      </p>,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://ok.io");
    expect(screen.getByText(/<b>x<\/b>/)).toBeInTheDocument();
  });
});
