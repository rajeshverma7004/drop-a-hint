import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Form, FormLayout, TextField, Banner } from "@shopify/polaris";

export function SupportModal({ isOpen, onClose, showToast }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const [fieldErrors, setFieldErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens or closes
  useEffect(() => {
    if (!isOpen) {
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
      setFieldErrors({});
      setServerError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const validateForm = () => {
    const errors = {};

    if (!name.trim()) {
      errors.name = "Name is required.";
    }

    if (!email.trim()) {
      errors.email = "Email address is required.";
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        errors.email = "Please enter a valid email address.";
      }
    }

    if (!subject.trim()) errors.subject = "Subject is required.";
    if (!message.trim()) errors.message = "Message details are required.";

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setServerError(null);

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          subject: subject.trim(),
          message: message.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        if (result.details) {
          setFieldErrors(result.details);
        }
        setServerError(result.error || "Failed to send support request. Please try again.");
        setIsSubmitting(false);
        return;
      }

      // Success
      setIsSubmitting(false);
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
      setFieldErrors({});
      setServerError(null);
      onClose();

      if (showToast) {
        showToast("Support request submitted successfully! We will get back to you shortly.");
      }
    } catch (err) {
      console.error("Support form submission error:", err);
      setServerError("An unexpected error occurred while sending your request. Please check your network connection.");
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={isSubmitting ? undefined : onClose}
      title="Customer Support & Assistance"
      primaryAction={{
        content: isSubmitting ? "Sending..." : "Send Support Ticket",
        onAction: handleSubmit,
        loading: isSubmitting,
        disabled: isSubmitting,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: onClose,
          disabled: isSubmitting,
        },
      ]}
    >
      <Modal.Section>
        <Form onSubmit={handleSubmit}>
          <FormLayout>
            {serverError && (
              <Banner title="Error sending ticket" tone="critical">
                <p>{serverError}</p>
              </Banner>
            )}

            <TextField
              label="Name"
              value={name}
              onChange={(val) => {
                setName(val);
                if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: null }));
              }}
              placeholder="Your Full Name"
              autoComplete="name"
              disabled={isSubmitting}
              error={fieldErrors.name}
              requiredIndicator
            />

            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(val) => {
                setEmail(val);
                if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: null }));
              }}
              placeholder="Email Address"
              autoComplete="email"
              disabled={isSubmitting}
              error={fieldErrors.email}
              requiredIndicator
            />

            <TextField
              label="Subject"
              value={subject}
              onChange={(val) => {
                setSubject(val);
                if (fieldErrors.subject) setFieldErrors((prev) => ({ ...prev, subject: null }));
              }}
              placeholder="How can we help you?"
              autoComplete="off"
              disabled={isSubmitting}
              error={fieldErrors.subject}
              requiredIndicator
            />

            <TextField
              label="Message / Details"
              value={message}
              onChange={(val) => {
                setMessage(val);
                if (fieldErrors.message) setFieldErrors((prev) => ({ ...prev, message: null }));
              }}
              placeholder="Describe your question, theme setup issue, or feature request..."
              multiline={5}
              autoComplete="off"
              disabled={isSubmitting}
              error={fieldErrors.message}
              requiredIndicator
            />
          </FormLayout>
        </Form>
      </Modal.Section>
    </Modal>
  );
}

SupportModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  showToast: PropTypes.func,
};
