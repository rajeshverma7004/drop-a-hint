import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Form, FormLayout, Select, TextField, Button, BlockStack } from "@shopify/polaris";
import { useSaveBar } from "../context/SaveBarContext";

export function DiscountSettings({ initialSettings, onSave, showToast }) {
  const [savedSettings, setSavedSettings] = useState({
    discountType: initialSettings?.discountType || "percentage",
    discountValue: initialSettings?.discountValue || "15",
    customMessage:
      initialSettings?.customMessage ||
      "Hey! Your friend thought you'd love this product. Check it out!",
  });

  const [discountType, setDiscountType] = useState(savedSettings.discountType);
  const [discountValue, setDiscountValue] = useState(savedSettings.discountValue);
  const [customMessage, setCustomMessage] = useState(savedSettings.customMessage);

  const { setDirty, registerHandlers, unregisterHandlers } = useSaveBar();

  // Sync savedSettings if initialSettings change externally
  useEffect(() => {
    if (initialSettings) {
      const updated = {
        discountType: initialSettings.discountType || "percentage",
        discountValue: initialSettings.discountValue || "15",
        customMessage:
          initialSettings.customMessage ||
          "Hey! Your friend thought you'd love this product. Check it out!",
      };
      setSavedSettings(updated);
      setDiscountType(updated.discountType);
      setDiscountValue(updated.discountValue);
      setCustomMessage(updated.customMessage);
    }
  }, [initialSettings]);

  // Compute dirty state
  const isDirty =
    discountType !== savedSettings.discountType ||
    discountValue !== savedSettings.discountValue ||
    customMessage !== savedSettings.customMessage;

  const handleExecuteSave = useCallback(async () => {
    const settings = {
      discountType,
      discountValue,
      customMessage,
    };
    if (onSave) {
      await onSave(settings);
    } else if (showToast) {
      showToast("Discount settings saved successfully!");
    }
    setSavedSettings(settings);
    setDirty(false);
  }, [discountType, discountValue, customMessage, onSave, showToast, setDirty]);

  const handleExecuteDiscard = useCallback(() => {
    setDiscountType(savedSettings.discountType);
    setDiscountValue(savedSettings.discountValue);
    setCustomMessage(savedSettings.customMessage);
    setDirty(false);
  }, [savedSettings, setDirty]);

  // Register with Global Save Bar Context
  useEffect(() => {
    setDirty(isDirty);
    if (isDirty) {
      registerHandlers({
        onSave: handleExecuteSave,
        onDiscard: handleExecuteDiscard,
      });
    } else {
      unregisterHandlers();
    }
  }, [isDirty, handleExecuteSave, handleExecuteDiscard, registerHandlers, unregisterHandlers, setDirty]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unregisterHandlers();
    };
  }, [unregisterHandlers]);

  const handleSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (isDirty) {
      handleExecuteSave();
    }
  };

  const discountTypeOptions = [
    { label: "Percentage Discount (%)", value: "percentage" },
    { label: "Fixed Amount Discount ($)", value: "fixed" },
  ];

  return (
    <div className="dah-settings-container" style={{ maxWidth: "680px" }}>
      <div className="dah-section-header" style={{ marginBottom: "24px" }}>
        <div className="dah-section-title-group">
          <h2 className="dah-section-title">Default Reward &amp; Email Settings</h2>
          <p className="dah-section-subtitle">
            Configure the baseline discount reward issued to referrers and the default invitation message sent to friends.
          </p>
        </div>
      </div>

      <Form onSubmit={handleSubmit}>
        <BlockStack gap="400">
          <FormLayout>
            <Select
              label="Reward Type"
              options={discountTypeOptions}
              onChange={setDiscountType}
              value={discountType}
              helpText="Type of reward coupon generated for referrer after friend purchases."
            />

            <TextField
              label={`Reward Value ${discountType === "percentage" ? "(%)" : "($)"}`}
              type="number"
              value={discountValue}
              onChange={setDiscountValue}
              placeholder="e.g. 20"
              min={1}
              autoComplete="off"
            />

            <TextField
              label="Invitation Mail Message (Friend receives this when product is referred)"
              value={customMessage}
              onChange={setCustomMessage}
              multiline={4}
              autoComplete="off"
              helpText="This default message is sent in the referral email when Customer A drops a hint to Friend B."
            />

            <div style={{ marginTop: "8px" }}>
              <Button submit variant="primary" disabled={!isDirty}>
                Save Settings
              </Button>
            </div>
          </FormLayout>
        </BlockStack>
      </Form>
    </div>
  );
}

DiscountSettings.propTypes = {
  initialSettings: PropTypes.shape({
    discountType: PropTypes.string,
    discountValue: PropTypes.string,
    customMessage: PropTypes.string,
  }),
  onSave: PropTypes.func,
  showToast: PropTypes.func,
};
