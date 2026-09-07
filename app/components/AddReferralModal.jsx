import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Form, FormLayout, TextField, Select } from "@shopify/polaris";

export function AddReferralModal({ isOpen, onClose, onAdd }) {
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverEmail, setReceiverEmail] = useState("");
  const [orderStatus, setOrderStatus] = useState("No");

  const handleSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!senderName || !senderEmail || !receiverName || !receiverEmail) return;

    onAdd({
      senderName,
      senderEmail,
      receiverName,
      receiverEmail,
      orderStatus,
    });

    setSenderName("");
    setSenderEmail("");
    setReceiverName("");
    setReceiverEmail("");
    setOrderStatus("No");
    onClose();
  };

  const statusOptions = [
    { label: "No", value: "No" },
    { label: "Yes", value: "Yes" },
    { label: "Pending", value: "Pending" },
  ];

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Add New Referral Record"
      primaryAction={{
        content: 'Add Referral',
        onAction: handleSubmit,
      }}
      secondaryActions={[
        {
          content: 'Cancel',
          onAction: onClose,
        },
      ]}
    >
      <Modal.Section>
        <Form onSubmit={handleSubmit}>
          <FormLayout>
            <FormLayout.Group>
              <TextField
                label="Sender Name"
                value={senderName}
                onChange={setSenderName}
                placeholder="e.g. rajesh"
                autoComplete="name"
              />
              <TextField
                label="Sender Email"
                type="email"
                value={senderEmail}
                onChange={setSenderEmail}
                placeholder="rajesh.verma@example.com"
                autoComplete="email"
              />
            </FormLayout.Group>

            <FormLayout.Group>
              <TextField
                label="Receiver Name"
                value={receiverName}
                onChange={setReceiverName}
                placeholder="e.g. Sanjay"
                autoComplete="name"
              />
              <TextField
                label="Receiver Email"
                type="email"
                value={receiverEmail}
                onChange={setReceiverEmail}
                placeholder="sanjay@example.com"
                autoComplete="email"
              />
            </FormLayout.Group>

            <Select
              label="Order Status"
              options={statusOptions}
              value={orderStatus}
              onChange={setOrderStatus}
            />
          </FormLayout>
        </Form>
      </Modal.Section>
    </Modal>
  );
}

AddReferralModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onAdd: PropTypes.func.isRequired,
};
