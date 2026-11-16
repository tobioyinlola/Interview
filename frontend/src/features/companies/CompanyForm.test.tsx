import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CompanyForm } from "./CompanyForm";

const form = (
  props: Partial<React.ComponentProps<typeof CompanyForm>> = {},
) => (
  <CompanyForm
    submitLabel="Save"
    pending={false}
    onSubmit={() => {}}
    {...props}
  />
);

describe("CompanyForm role", () => {
  it("adopts the notes role when it arrives after the form opened", () => {
    const { rerender } = render(form({ defaultRole: "" }));
    expect(screen.getByLabelText("Role")).toHaveValue("");
    rerender(form({ defaultRole: "Product Manager" }));
    expect(screen.getByLabelText("Role")).toHaveValue("Product Manager");
  });

  it("never overwrites a role the user has typed", async () => {
    const { rerender } = render(form({ defaultRole: "" }));
    await userEvent.type(screen.getByLabelText("Role"), "Data Scientist");
    rerender(form({ defaultRole: "Product Manager" }));
    expect(screen.getByLabelText("Role")).toHaveValue("Data Scientist");
  });

  it("lets the user clear the prefilled role", async () => {
    render(form({ defaultRole: "Product Manager" }));
    await userEvent.clear(screen.getByLabelText("Role"));
    expect(screen.getByLabelText("Role")).toHaveValue("");
  });

  it("keeps a saved company's role when editing, even if notes differ", () => {
    const { rerender } = render(
      form({ initial: { role: "Staff Engineer" }, defaultRole: "" }),
    );
    rerender(
      form({
        initial: { role: "Staff Engineer" },
        defaultRole: "Product Manager",
      }),
    );
    expect(screen.getByLabelText("Role")).toHaveValue("Staff Engineer");
  });
});
