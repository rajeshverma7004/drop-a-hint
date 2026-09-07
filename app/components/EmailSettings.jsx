import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Form, FormLayout, TextField, Button, BlockStack, Card, Box, Text, Banner } from "@shopify/polaris";
import { useSaveBar } from "../context/SaveBarContext";

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function EmailSettings({ initialSettings, onSave, showToast }) {
  const [savedSettings, setSavedSettings] = useState({
    senderEmail: initialSettings?.senderEmail || "",
    emailSubject: initialSettings?.emailSubject || "",
    confirmationSenderEmail: initialSettings?.confirmationSenderEmail || "",
    confirmationEmailSubject: initialSettings?.confirmationEmailSubject || "",
  });

  const [senderEmail, setSenderEmail] = useState(savedSettings.senderEmail);
  const [emailSubject, setEmailSubject] = useState(savedSettings.emailSubject);
  const [confirmationSenderEmail, setConfirmationSenderEmail] = useState(savedSettings.confirmationSenderEmail);
  const [confirmationEmailSubject, setConfirmationEmailSubject] = useState(savedSettings.confirmationEmailSubject);

  const [senderEmailError, setSenderEmailError] = useState("");
  const [confirmationEmailError, setConfirmationEmailError] = useState("");

  const { setDirty, registerHandlers, unregisterHandlers } = useSaveBar();

  // Sync state if initialSettings update externally
  useEffect(() => {
    if (initialSettings) {
      const updated = {
        senderEmail: initialSettings.senderEmail || "",
        emailSubject: initialSettings.emailSubject || "",
        confirmationSenderEmail: initialSettings.confirmationSenderEmail || "",
        confirmationEmailSubject: initialSettings.confirmationEmailSubject || "",
      };
      setSavedSettings(updated);
      setSenderEmail(updated.senderEmail);
      setEmailSubject(updated.emailSubject);
      setConfirmationSenderEmail(updated.confirmationSenderEmail);
      setConfirmationEmailSubject(updated.confirmationEmailSubject);
      setSenderEmailError("");
      setConfirmationEmailError("");
    }
  }, [initialSettings]);

  // Compute dirty state
  const isDirty =
    senderEmail !== savedSettings.senderEmail ||
    emailSubject !== savedSettings.emailSubject ||
    confirmationSenderEmail !== savedSettings.confirmationSenderEmail ||
    confirmationEmailSubject !== savedSettings.confirmationEmailSubject;

  const validate = useCallback(() => {
    let isValid = true;

    const trimmedSender = senderEmail.trim();
    if (trimmedSender && !isValidEmail(trimmedSender)) {
      setSenderEmailError("Please enter a valid sending email address (e.g. info@yourstore.com)");
      isValid = false;
    } else {
      setSenderEmailError("");
    }

    const trimmedConfirmationSender = confirmationSenderEmail.trim();
    if (trimmedConfirmationSender && !isValidEmail(trimmedConfirmationSender)) {
      setConfirmationEmailError("Please enter a valid sending email address (e.g. rewards@yourstore.com)");
      isValid = false;
    } else {
      setConfirmationEmailError("");
    }

    return isValid;
  }, [senderEmail, confirmationSenderEmail]);

  const handleExecuteSave = useCallback(async () => {
    if (!validate()) {
      if (showToast) showToast("Please fix the validation errors before saving.");
      return;
    }

    const payload = {
      senderEmail: senderEmail.trim(),
      emailSubject: emailSubject.trim(),
      confirmationSenderEmail: confirmationSenderEmail.trim(),
      confirmationEmailSubject: confirmationEmailSubject.trim(),
    };

    if (onSave) {
      await onSave(payload);
    } else if (showToast) {
      showToast("Email settings saved successfully!");
    }

    setSavedSettings(payload);
    setDirty(false);
  }, [validate, senderEmail, emailSubject, confirmationSenderEmail, confirmationEmailSubject, onSave, showToast, setDirty]);

  const handleExecuteDiscard = useCallback(() => {
    setSenderEmail(savedSettings.senderEmail);
    setEmailSubject(savedSettings.emailSubject);
    setConfirmationSenderEmail(savedSettings.confirmationSenderEmail);
    setConfirmationEmailSubject(savedSettings.confirmationEmailSubject);
    setSenderEmailError("");
    setConfirmationEmailError("");
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

  return (
    <div className="dah-settings-container" style={{ maxWidth: "680px" }}>
      <div className="dah-section-header" style={{ marginBottom: "24px" }}>
        <div className="dah-section-title-group">
          <h2 className="dah-section-title">Product Referral Emails</h2>
          <p className="dah-section-subtitle">
            Configure custom email subjects and sending email addresses for product referral notifications.
          </p>
        </div>
      </div>

      <Form onSubmit={handleSubmit}>
        <BlockStack gap="600">
          <Banner title="SendGrid Sender Identity Requirement" tone="info">
            <p>
              Your email provider (SendGrid) requires any custom <strong>Sending Email</strong> (or domain) to be verified under <strong>SendGrid &gt; Settings &gt; Sender Authentication</strong> before sending emails.
            </p>
            <p style={{ marginTop: "4px" }}>
              If an unverified sending email is used, SendGrid will reject outgoing emails. Leave blank to use your default verified sender.
            </p>
          </Banner>
          {/* Subsection A: Product Referral Sent */}
          <Card padding="500">
            <BlockStack gap="400">
              <Box>
                <Text variant="headingMd" as="h3" fontWeight="bold">
                  A. Product Referral Sent
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  Sent to Friend (User B) when User A refers a product to them via the Theme Block.
                </Text>
              </Box>

              <FormLayout>
                <TextField
                  label="Subject"
                  type="text"
                  value={emailSubject}
                  onChange={setEmailSubject}
                  placeholder="e.g. {{sender_name}} invited you to check out a product!"
                  helpText="Subject line for referral emails sent to friends. Supports placeholders: {{sender_name}}, {{receiver_name}}, {{product_title}}, {{shop}}. Leave empty for default."
                  autoComplete="off"
                />

                <TextField
                  label="Sending Email"
                  type="email"
                  value={senderEmail}
                  onChange={(val) => {
                    setSenderEmail(val);
                    if (senderEmailError) setSenderEmailError("");
                  }}
                  error={senderEmailError}
                  placeholder="e.g. info@yourstore.com"
                  helpText="Sending email address used for outgoing referral emails sent to friends. Leave empty to use default."
                  autoComplete="email"
                />
              </FormLayout>
            </BlockStack>
          </Card>

          {/* Subsection B: Referral Purchase Confirmation */}
          <Card padding="500">
            <BlockStack gap="400">
              <Box>
                <Text variant="headingMd" as="h3" fontWeight="bold">
                  B. Referral Purchase Confirmation
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  Sent to Referrer (User A) when User B purchases the referred product.
                </Text>
              </Box>

              <FormLayout>
                <TextField
                  label="Subject"
                  type="text"
                  value={confirmationEmailSubject}
                  onChange={setConfirmationEmailSubject}
                  placeholder="e.g. 🎉 Your Referral Was Successful! Here's Your Reward"
                  helpText="Subject line for confirmation emails sent to referrers. Supports placeholders: {{sender_name}}, {{discount_code}}, {{discount_amount}}, {{shop}}. Leave empty for default."
                  autoComplete="off"
                />

                <TextField
                  label="Sending Email"
                  type="email"
                  value={confirmationSenderEmail}
                  onChange={(val) => {
                    setConfirmationSenderEmail(val);
                    if (confirmationEmailError) setConfirmationEmailError("");
                  }}
                  error={confirmationEmailError}
                  placeholder="e.g. rewards@yourstore.com"
                  helpText="Sending email address used for outgoing confirmation emails sent to referrers. Leave empty to use default."
                  autoComplete="email"
                />
              </FormLayout>
            </BlockStack>
          </Card>

          <div style={{ marginTop: "8px" }}>
            <Button submit variant="primary" disabled={!isDirty}>
              Save Settings
            </Button>
          </div>
        </BlockStack>
      </Form>
    </div>
  );
}

EmailSettings.propTypes = {
  initialSettings: PropTypes.shape({
    senderEmail: PropTypes.string,
    emailSubject: PropTypes.string,
    confirmationSenderEmail: PropTypes.string,
    confirmationEmailSubject: PropTypes.string,
  }),
  onSave: PropTypes.func,
  showToast: PropTypes.func,
};
