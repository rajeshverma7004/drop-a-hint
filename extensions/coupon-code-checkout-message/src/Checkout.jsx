import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [inputCode, setInputCode] = useState("");
  const [inputError, setInputError] = useState("");
  const [isChecking, setIsChecking] = useState(false);

  const handleValidateInput = async (e) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!inputCode.trim()) return;
    const clean = inputCode.trim().toUpperCase();
    setIsChecking(true);
    setInputError("");

    try {
      // Validate with app backend first
      const res = await fetch(`/apps/drop-a-hint?action=validate_coupon&code=${encodeURIComponent(clean)}`);
      let data = null;
      if (res.ok) {
        data = await res.json();
      }

      if (data && !data.valid && data.error) {
        setInputError(data.error);
        setIsChecking(false);
        return;
      }

      // Apply to checkout using Shopify Checkout API
      const applyFn = shopify?.applyDiscountCodeChange;
      if (applyFn) {
        const result = await applyFn({
          type: "addDiscountCode",
          code: clean,
        });

        if (result?.type === "error") {
          setInputError(result.message || "Failed to apply discount code");
        } else {
          setInputCode("");
          setInputError("");
        }
      }
    } catch (err) {
      console.warn("[Apply Discount Error]:", err);
      setInputError("Failed to apply discount code");
    } finally {
      setIsChecking(false);
    }
  };

  const isBlockTarget = shopify?.extension?.target?.includes("block") || false;

  if (!inputError && !isBlockTarget) {
    return null;
  }

  return (
    <s-stack gap="base">
      {inputError.length > 0 && (
        <s-banner tone="critical" heading="Discount Notice">
          <s-text>{inputError}</s-text>
        </s-banner>
      )}

      {isBlockTarget && (
        <s-form onSubmit={handleValidateInput}>
          <s-stack direction="inline" gap="tight" blockAlign="center">
            <s-text-field
              label="Discount Code"
              value={inputCode}
              onInput={(e) => {
                setInputCode(e.target.value);
                if (inputError) setInputError("");
              }}
              placeholder="Enter coupon code"
            />
            <s-button
              type="submit"
              loading={isChecking}
              disabled={isChecking || !inputCode.trim()}
            >
              Apply
            </s-button>
          </s-stack>
        </s-form>
      )}
    </s-stack>
  );
}