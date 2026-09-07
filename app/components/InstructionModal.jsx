import PropTypes from "prop-types";
import { Modal, Text, Banner, BlockStack, Box, InlineStack, Badge } from "@shopify/polaris";

export function InstructionModal({ isOpen, onClose }) {
  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Installation & Integration Guide"
      primaryAction={{
        content: "Got It",
        onAction: onClose,
      }}
    >
      <Modal.Section>
        <BlockStack gap="400">
          {/* Step 1 */}
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="info">Step 1</Badge>
                <Text variant="headingSm" as="h4" fontWeight="semibold">
                  Enable App Embed Extension
                </Text>
              </InlineStack>
              <Text variant="bodyMd" as="p" tone="subdued">
                In your Shopify Admin, navigate to <strong>Online Store &gt; Themes &gt; Customize</strong>. In the left sidebar, click the <strong>App Embeds</strong> tab, turn on <strong>Drop A Hint</strong>, and click <strong>Save</strong>.
              </Text>
            </BlockStack>
          </Box>

          {/* Step 2 */}
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="info">Step 2</Badge>
                <Text variant="headingSm" as="h4" fontWeight="semibold">
                  Add &ldquo;Drop A Hint&rdquo; Button to Product Page
                </Text>
              </InlineStack>
              <Text variant="bodyMd" as="p" tone="subdued">
                In the Theme Editor, select <strong>Products &gt; Default product</strong> template. Under the Product Information section, click <strong>Add Block</strong>, choose <strong>Drop A Hint Button</strong>, and drag it near your Add to Cart button.
              </Text>
            </BlockStack>
          </Box>

          {/* Step 3 */}
          <Box background="bg-surface-secondary" padding="300" borderRadius="200">
            <BlockStack gap="100">
              <InlineStack gap="200" blockAlign="center">
                <Badge tone="info">Step 3</Badge>
                <Text variant="headingSm" as="h4" fontWeight="semibold">
                  Test Storefront Flow
                </Text>
              </InlineStack>
              <Text variant="bodyMd" as="p" tone="subdued">
                Save your theme changes and visit any active product page on your storefront. Click the <strong>Drop A Hint</strong> button to verify the modal pop-up, referral creation, and email notifications.
              </Text>
            </BlockStack>
          </Box>

          <Banner tone="info">
            <p>
              <strong>Tip:</strong> You can configure global discount percentages and reward settings under the <strong>Discount Settings</strong> tab, or configure per-product pricing under <strong>Product Specific Discount</strong>.
            </p>
          </Banner>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

InstructionModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
