import { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";
import { useFetcher } from "react-router";
import {
  Modal,
  Form,
  Select,
  TextField,
  Spinner,
  ResourceList,
  ResourceItem,
  Thumbnail,
  Text,
  BlockStack,
  InlineStack,
  Banner,
  Box,
  Button,
  Icon,
} from "@shopify/polaris";
import { SearchIcon, XCircleIcon } from "@shopify/polaris-icons";

export function AddProductDiscountModal({ isOpen, onClose, onSaved, editRule }) {
  const isEditMode = Boolean(editRule);

  // Form state
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [status, setStatus] = useState("Active");
  const [selectedProduct, setSelectedProduct] = useState(null);

  // Product search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Validation / error state
  const [errors, setErrors] = useState({});
  const [bannerError, setBannerError] = useState(null);

  // Fetchers
  const searchFetcher = useFetcher();
  const saveFetcher = useFetcher();

  const debounceTimer = useRef(null);
  const lastProcessedSaveRef = useRef(null);

  // Pre-fill when editing
  useEffect(() => {
    if (editRule) {
      setDiscountType(editRule.discountType || "percentage");
      setDiscountValue(editRule.discountValue || "");
      setStatus(editRule.status || "Active");
      setSelectedProduct({
        id: editRule.shopifyProductId,
        title: editRule.productTitle,
        image: editRule.productImage || null,
        sku: editRule.sku || "",
        variants: [],
      });
    } else {
      resetForm();
    }
  }, [editRule, isOpen]);

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      resetForm();
    }
  }, [isOpen]);

  // Handle search fetcher response
  useEffect(() => {
    if (searchFetcher.data) {
      setSearchResults(searchFetcher.data.products || []);
      setIsSearching(false);
      setHasSearched(true);
    }
  }, [searchFetcher.data]);

  // Handle save fetcher response
  useEffect(() => {
    if (saveFetcher.data && lastProcessedSaveRef.current !== saveFetcher.data) {
      lastProcessedSaveRef.current = saveFetcher.data;
      if (saveFetcher.data.success) {
        onSaved(saveFetcher.data.rule, isEditMode ? "updated" : "created");
        onClose();
        resetForm();
      } else if (saveFetcher.data.error) {
        setBannerError(saveFetcher.data.error);
      }
    }
  }, [saveFetcher.data, isEditMode, onSaved, onClose]);

  const resetForm = () => {
    setDiscountType("percentage");
    setDiscountValue("");
    setStatus("Active");
    setSelectedProduct(null);
    setSearchQuery("");
    setSearchResults([]);
    setIsSearching(false);
    setHasSearched(false);
    setErrors({});
    setBannerError(null);
  };

  // Debounced product search
  const handleSearchChange = useCallback((value) => {
    setSearchQuery(value);
    setHasSearched(false);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (value.trim().length === 0) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceTimer.current = setTimeout(() => {
      searchFetcher.load(
        `/app/products?action=search&q=${encodeURIComponent(value.trim())}`
      );
    }, 350);
  }, [searchFetcher]);

  const handleSelectProduct = (product) => {
    const sku =
      product.variants?.[0]?.sku ||
      `SKU-${String(product.id).replace(/\D/g, "").slice(-3) || "001"}`;
    setSelectedProduct({
      ...product,
      sku,
    });
    setSearchQuery("");
    setSearchResults([]);
    setHasSearched(false);
    setErrors((prev) => ({ ...prev, product: null }));
  };

  const handleClearProduct = () => {
    setSelectedProduct(null);
  };

  const validate = () => {
    const newErrors = {};
    if (!selectedProduct) newErrors.product = "Please select a product";
    if (!discountType) newErrors.discountType = "Please select a discount type";
    if (!discountValue || discountValue.trim() === "") {
      newErrors.discountValue = "Please enter a discount value";
    } else if (parseFloat(discountValue) <= 0) {
      newErrors.discountValue = "Discount value must be greater than 0";
    } else if (discountType === "percentage" && parseFloat(discountValue) > 100) {
      newErrors.discountValue = "Percentage discount cannot exceed 100%";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    setBannerError(null);
    if (!validate()) return;

    const formData = new FormData();
    if (isEditMode) {
      formData.append("intent", "update_product_rule");
      formData.append("id", String(editRule.id));
    } else {
      formData.append("intent", "save_product_rule");
      formData.append("shopifyProductId", selectedProduct.id);
      formData.append("productTitle", selectedProduct.title);
      if (selectedProduct.image) {
        formData.append("productImage", selectedProduct.image);
      }
    }
    formData.append("discountType", discountType);
    formData.append("discountValue", discountValue);
    formData.append("status", status);

    saveFetcher.submit(formData, { method: "post", action: "/app/products" });
  };

  const isSaving = saveFetcher.state === "submitting";

  const discountTypeOptions = [
    { label: "Percentage (%)", value: "percentage" },
    { label: "Fixed Amount ($)", value: "fixed" },
  ];

  const statusOptions = [
    { label: "Active", value: "Active" },
    { label: "Draft", value: "Draft" },
  ];

  const discountValuePrefix = discountType === "fixed" ? "$" : undefined;
  const discountValueSuffix = discountType === "percentage" ? "%" : undefined;

  const fallbackImage =
    "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-product-1.png";

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={
        isEditMode
          ? "Edit Product Discount Rule"
          : "Add Product Discount Rule"
      }
      primaryAction={{
        content: isSaving ? "Saving..." : "Save Rule",
        onAction: handleSave,
        loading: isSaving,
        disabled: isSaving,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: onClose,
          disabled: isSaving,
        },
      ]}
    >
      <Modal.Section>
        <Form onSubmit={handleSave}>
          <BlockStack gap="400">
            {/* Error banner */}
            {bannerError && (
              <Banner
                title={bannerError}
                tone="critical"
                onDismiss={() => setBannerError(null)}
              />
            )}

            {/* Product Selection */}
            <BlockStack gap="200">
              <Text variant="headingSm" as="h3" fontWeight="semibold">
                Product
              </Text>

              {errors.product && (
                <Text tone="critical" variant="bodySm">
                  {errors.product}
                </Text>
              )}

              {/* Selected product card */}
              {selectedProduct ? (
                <Box
                  background="bg-surface-secondary"
                  borderRadius="200"
                  padding="300"
                  borderColor={errors.product ? "border-critical" : "border"}
                  borderWidth="025"
                >
                  <InlineStack gap="300" align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Thumbnail
                        source={selectedProduct.image || fallbackImage}
                        alt={selectedProduct.title}
                        size="small"
                      />
                      <BlockStack gap="050">
                        <Text variant="bodyMd" fontWeight="semibold">
                          {selectedProduct.title}
                        </Text>
                        <Text variant="bodySm" tone="subdued">
                          {selectedProduct.sku ||
                            `SKU-${String(selectedProduct.id).replace(/\D/g, "").slice(-3) || "001"}`}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    {!isEditMode && (
                      <Button
                        variant="plain"
                        tone="critical"
                        onClick={handleClearProduct}
                        icon={XCircleIcon}
                        accessibilityLabel="Remove selected product"
                      />
                    )}
                  </InlineStack>
                </Box>
              ) : (
                /* Search Products */
                <BlockStack gap="200">
                  <TextField
                    label="Search Products"
                    labelHidden
                    value={searchQuery}
                    onChange={handleSearchChange}
                    placeholder="Search product by title or SKU..."
                    prefix={<Icon source={SearchIcon} />}
                    autoComplete="off"
                    clearButton
                    onClearButtonClick={() => {
                      setSearchQuery("");
                      setSearchResults([]);
                      setHasSearched(false);
                    }}
                  />

                  {/* Searching spinner */}
                  {isSearching && (
                    <Box padding="300">
                      <InlineStack align="center" gap="200">
                        <Spinner size="small" />
                        <Text variant="bodySm" tone="subdued">
                          Searching products...
                        </Text>
                      </InlineStack>
                    </Box>
                  )}

                  {/* Empty search results */}
                  {!isSearching && hasSearched && searchResults.length === 0 && (
                    <Box
                      background="bg-surface-secondary"
                      borderRadius="200"
                      padding="300"
                      borderColor="border"
                      borderWidth="025"
                    >
                      <Text variant="bodySm" tone="subdued" alignment="center">
                        No products found matching &ldquo;{searchQuery}&rdquo;
                      </Text>
                    </Box>
                  )}

                  {/* Results list */}
                  {!isSearching && searchResults.length > 0 && (
                    <Box
                      background="bg-surface"
                      borderRadius="200"
                      borderColor="border"
                      borderWidth="025"
                      maxHeight="220px"
                      overflowY="auto"
                    >
                      <ResourceList
                        resourceName={{ singular: "product", plural: "products" }}
                        items={searchResults}
                        renderItem={(product) => (
                          <ResourceItem
                            id={product.id}
                            media={
                              <Thumbnail
                                source={product.image || fallbackImage}
                                alt={product.title}
                                size="small"
                              />
                            }
                            onClick={() => handleSelectProduct(product)}
                            accessibilityLabel={`Select ${product.title}`}
                          >
                            <BlockStack gap="050">
                              <Text variant="bodyMd" fontWeight="semibold">
                                {product.title}
                              </Text>
                              <Text variant="bodySm" tone="subdued">
                                {product.variants?.[0]?.sku ||
                                  `SKU-${String(product.id).replace(/\D/g, "").slice(-3) || "001"}`}
                                {product.variants?.[0]?.price
                                  ? ` · $${product.variants[0].price}`
                                  : ""}
                              </Text>
                            </BlockStack>
                          </ResourceItem>
                        )}
                      />
                    </Box>
                  )}
                </BlockStack>
              )}
            </BlockStack>

            {/* Discount Type Select */}
            <Select
              label="Discount Type"
              options={discountTypeOptions}
              onChange={(val) => {
                setDiscountType(val);
                setErrors((prev) => ({ ...prev, discountType: null }));
              }}
              value={discountType}
              error={errors.discountType}
            />

            {/* Discount Value Input */}
            <TextField
              label="Value"
              type="number"
              value={discountValue}
              onChange={(val) => {
                setDiscountValue(val);
                setErrors((prev) => ({ ...prev, discountValue: null }));
              }}
              placeholder={discountType === "percentage" ? "2" : "10"}
              min={0.01}
              step={discountType === "percentage" ? 1 : 0.01}
              autoComplete="off"
              error={errors.discountValue}
              prefix={discountValuePrefix}
              suffix={discountValueSuffix}
              helpText={
                discountType === "percentage"
                  ? "Enter percentage discount (e.g. 2 for 2%)"
                  : "Enter fixed discount amount in store currency"
              }
            />

            {/* Status Select */}
            <Select
              label="Status"
              options={statusOptions}
              onChange={(val) => setStatus(val)}
              value={status}
            />
          </BlockStack>
        </Form>
      </Modal.Section>
    </Modal>
  );
}

AddProductDiscountModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSaved: PropTypes.func.isRequired,
  editRule: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    shopifyProductId: PropTypes.string,
    productTitle: PropTypes.string,
    sku: PropTypes.string,
    productImage: PropTypes.string,
    discountType: PropTypes.string,
    discountValue: PropTypes.string,
    status: PropTypes.string,
  }),
};
