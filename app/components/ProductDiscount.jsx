import { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { useFetcher } from "react-router";
import { Modal, Text, Box } from "@shopify/polaris";
import { AddProductDiscountModal } from "./AddProductDiscountModal";

export function ProductDiscount({ initialRules = [], showToast }) {
  const [rules, setRules] = useState(Array.isArray(initialRules) ? initialRules : []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [deleteConfirmRule, setDeleteConfirmRule] = useState(null);

  const deleteFetcher = useFetcher();
  const toggleFetcher = useFetcher();

  const lastProcessedToggleRef = useRef(null);
  const lastProcessedDeleteRef = useRef(null);

  // Sync when initial data changes from server
  useEffect(() => {
    setRules(Array.isArray(initialRules) ? initialRules : []);
  }, [initialRules]);

  // Handle delete fetcher errors (success notification is handled on action execution)
  useEffect(() => {
    if (
      deleteFetcher.data?.error &&
      lastProcessedDeleteRef.current !== deleteFetcher.data
    ) {
      lastProcessedDeleteRef.current = deleteFetcher.data;
      showToast?.(deleteFetcher.data.error);
    }
  }, [deleteFetcher.data, showToast]);

  // Handle toggle status fetcher response exactly once per unique response payload
  useEffect(() => {
    if (
      toggleFetcher.data?.success &&
      toggleFetcher.data?.rule &&
      lastProcessedToggleRef.current !== toggleFetcher.data
    ) {
      lastProcessedToggleRef.current = toggleFetcher.data;
      const updated = toggleFetcher.data.rule;
      setRules((prev) =>
        prev.map((r) => (r.id === updated.id ? { ...r, status: updated.status } : r))
      );
      showToast?.(
        `Rule for "${updated.productTitle}" is now ${updated.status}`
      );
    } else if (
      toggleFetcher.data?.error &&
      lastProcessedToggleRef.current !== toggleFetcher.data
    ) {
      lastProcessedToggleRef.current = toggleFetcher.data;
      showToast?.(toggleFetcher.data.error);
    }
  }, [toggleFetcher.data, showToast]);

  const handleOpenAdd = useCallback(() => {
    setEditRule(null);
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((rule) => {
    setEditRule(rule);
    setIsModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
    setEditRule(null);
  }, []);

  const handleSaved = useCallback((savedRule, mode) => {
    if (mode === "created") {
      setRules((prev) => [savedRule, ...prev]);
      showToast?.(`Discount rule created for "${savedRule.productTitle}"`);
    } else {
      setRules((prev) =>
        prev.map((r) => (r.id === savedRule.id ? { ...r, ...savedRule } : r))
      );
      showToast?.(`Discount rule updated for "${savedRule.productTitle}"`);
    }
  }, [showToast]);

  const handleDeleteConfirm = useCallback((rule) => {
    setDeleteConfirmRule(rule);
  }, []);

  const handleDeleteExecute = useCallback(() => {
    if (!deleteConfirmRule) return;
    const id = deleteConfirmRule.id;
    const ruleTitle = deleteConfirmRule.productTitle;
    setDeleteConfirmRule(null);

    // Optimistic removal
    setRules((prev) => prev.filter((r) => r.id !== id));

    const formData = new FormData();
    formData.append("intent", "delete_product_rule");
    formData.append("id", String(id));
    deleteFetcher.submit(formData, { method: "post", action: "/app/products" });

    showToast?.(`Discount rule for "${ruleTitle}" removed`);
  }, [deleteConfirmRule, deleteFetcher, showToast]);

  const handleToggleStatus = useCallback((rule) => {
    const nextStatus = rule.status === "Active" ? "Draft" : "Active";

    // Optimistic update
    setRules((prev) =>
      prev.map((r) =>
        r.id === rule.id ? { ...r, status: nextStatus } : r
      )
    );

    const formData = new FormData();
    formData.append("intent", "toggle_status");
    formData.append("id", String(rule.id));
    formData.append("currentStatus", rule.status);
    toggleFetcher.submit(formData, { method: "post", action: "/app/products" });
  }, [toggleFetcher]);

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return String(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatDiscountValue = (rule) => {
    if (rule.discountType === "percentage") {
      return `${rule.discountValue}%`;
    }
    return `$${rule.discountValue}`;
  };

  const getProductSku = (rule, index) => {
    if (rule.sku) return rule.sku;
    // Derive a clean SKU based on index or product ID
    const num = String(index + 1).padStart(3, "0");
    return `SKU-${num}`;
  };

  return (
    <div className="dah-product-discount-container">
      {/* Section Header */}
      <div className="dah-section-header">
        <div className="dah-section-title-group">
          <h2 className="dah-section-title">Product Discount Rules</h2>
          <p className="dah-section-subtitle">
            Manage pricing for individual products
          </p>
        </div>

        <button
          type="button"
          className="dah-btn-primary"
          onClick={handleOpenAdd}
          aria-label="Add Product Discount Rule"
        >
          + Add Product Rule
        </button>
      </div>

      {/* Product Rules Table */}
      <div className="dah-table-wrapper">
        <table className="dah-pdr-table" role="table" aria-label="Product Discount Rules">
          <thead>
            <tr role="row">
              <th scope="col" className="col-product">
                PRODUCT
              </th>
              <th scope="col" className="col-type">
                TYPE
              </th>
              <th scope="col" className="col-value">
                VALUE
              </th>
              <th scope="col" className="col-status">
                STATUS
              </th>
              <th scope="col" className="col-date">
                DATE
              </th>
              <th scope="col" className="col-actions">
                ACTIONS
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr role="row">
                <td
                  colSpan={6}
                  style={{
                    textAlign: "center",
                    padding: "48px 16px",
                    color: "var(--color-text-subdued)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "14px",
                        fontWeight: 600,
                        color: "var(--color-text)",
                      }}
                    >
                      No product discount rules found
                    </span>
                    <span style={{ fontSize: "13px" }}>
                      Click &ldquo;+ Add Product Rule&rdquo; above to set up custom discounts for specific products.
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              rules.map((rule, index) => {
              const sku = getProductSku(rule, index);
              const isActive = (rule.status || "").toLowerCase() === "active";

              return (
                <tr key={rule.id || index} role="row">
                  {/* PRODUCT Column (Thumbnail + Title + SKU) */}
                  <td className="col-product">
                    <div className="dah-product-cell">
                      {rule.productImage ? (
                        <img
                          src={rule.productImage}
                          alt={rule.productTitle}
                          className="dah-product-thumb"
                          onError={(e) => {
                            e.target.style.display = "none";
                            if (e.target.nextSibling) {
                              e.target.nextSibling.style.display = "flex";
                            }
                          }}
                        />
                      ) : null}
                      <div
                        className="dah-product-thumb-placeholder"
                        style={{ display: rule.productImage ? "none" : "flex" }}
                        aria-hidden="true"
                      >
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="3" width="14" height="14" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="17 13 13 9 5 17" />
                        </svg>
                      </div>

                      <div className="dah-product-info">
                        <span className="dah-product-title" title={rule.productTitle}>
                          {rule.productTitle}
                        </span>
                        <span className="dah-product-sku">{sku}</span>
                      </div>
                    </div>
                  </td>

                  {/* TYPE Column */}
                  <td className="col-type">
                    <span className="dah-type-cell">
                      {rule.discountType === "percentage"
                        ? "Percentage (%)"
                        : "Fixed Amount ($)"}
                    </span>
                  </td>

                  {/* VALUE Column (Clickable to edit) */}
                  <td className="col-value">
                    <button
                      type="button"
                      className="dah-value-cell"
                      onClick={() => handleOpenEdit(rule)}
                      title="Click to edit rule value"
                      aria-label={`Edit value for ${rule.productTitle}: ${formatDiscountValue(rule)}`}
                    >
                      {formatDiscountValue(rule)}
                    </button>
                  </td>

                  {/* STATUS Column (Interactive Badge) */}
                  <td className="col-status">
                    <button
                      type="button"
                      className={`dah-status-badge ${isActive ? "active" : "draft"}`}
                      onClick={() => handleToggleStatus(rule)}
                      title={`Click to switch status to ${isActive ? "Draft" : "Active"}`}
                      aria-label={`Toggle status for ${rule.productTitle}. Currently ${rule.status || "Active"}`}
                    >
                      {isActive ? "Active" : "Draft"}
                    </button>
                  </td>

                  {/* DATE Column */}
                  <td className="col-date">
                    <span className="dah-date-cell">
                      {formatDate(rule.createdAt)}
                    </span>
                  </td>

                  {/* ACTIONS Column (Edit & Delete Icon Buttons) */}
                  <td className="col-actions">
                    <div className="dah-actions-cell">
                      {/* Edit Button */}
                      <button
                        type="button"
                        className="dah-icon-btn dah-icon-btn-edit"
                        onClick={() => handleOpenEdit(rule)}
                        title="Edit rule"
                        aria-label={`Edit discount rule for ${rule.productTitle}`}
                      >
                        <svg
                          className="dah-icon-svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>

                      {/* Delete Button */}
                      <button
                        type="button"
                        className="dah-icon-btn dah-icon-btn-delete"
                        onClick={() => handleDeleteConfirm(rule)}
                        title="Delete rule"
                        aria-label={`Delete discount rule for ${rule.productTitle}`}
                      >
                        <svg
                          className="dah-icon-svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
        </table>
      </div>

      {/* Add / Edit Product Rule Modal */}
      <AddProductDiscountModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        onSaved={handleSaved}
        editRule={editRule}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(deleteConfirmRule)}
        onClose={() => setDeleteConfirmRule(null)}
        title="Delete Discount Rule"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDeleteExecute,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteConfirmRule(null),
          },
        ]}
      >
        <Modal.Section>
          <Box padding="100">
            <Text variant="bodyMd" as="p">
              Are you sure you want to delete the product discount rule for{" "}
              <Text as="span" fontWeight="semibold">
                &ldquo;{deleteConfirmRule?.productTitle}&rdquo;
              </Text>
              ? This action will remove the custom pricing rule permanently.
            </Text>
          </Box>
        </Modal.Section>
      </Modal>
    </div>
  );
}

ProductDiscount.propTypes = {
  initialRules: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
      shopifyProductId: PropTypes.string.isRequired,
      productTitle: PropTypes.string.isRequired,
      sku: PropTypes.string,
      productImage: PropTypes.string,
      discountType: PropTypes.string.isRequired,
      discountValue: PropTypes.string.isRequired,
      status: PropTypes.string,
      createdAt: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    })
  ),
  showToast: PropTypes.func,
};
