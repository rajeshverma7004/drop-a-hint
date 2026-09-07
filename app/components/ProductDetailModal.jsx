import PropTypes from "prop-types";
import {
  Modal,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Divider,
  Box,
  InlineGrid,
  Card,
  Button,
} from "@shopify/polaris";

export function ProductDetailModal({
  item,
  onClose,
  onReconcile,
  isReconciling = false,
  onRetryEmail,
  isRetryingEmail = false,
}) {
  if (!item) return null;

  const rewardDisplay =
    item.rewardType === "percentage"
      ? `${item.rewardValue || "15"}% Discount`
      : `$${item.rewardValue || "15"} Fixed Discount`;

  const getStatusTone = (status) => {
    const s = (status || "").toLowerCase();
    if (s.includes("redeemed")) return "success";
    if (s.includes("reward issued") || s.includes("ordered") || s.includes("completed")) return "success";
    if (s.includes("paid")) return "info";
    if (s.includes("purchased")) return "warning";
    if (s.includes("cancel") || s.includes("refund")) return "critical";
    return "attention";
  };

  const isPendingOrUnpaid = item.orderStatus === "Pending" || item.orderStatus === "Purchased";

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={`Referral #${item.id} Details`}
      primaryAction={{
        content: "Close",
        onAction: onClose,
      }}
      secondaryActions={
        isPendingOrUnpaid && onReconcile
          ? [
              {
                content: "Diagnose & Sync Order",
                onAction: () => onReconcile(item.id),
                loading: isReconciling,
              },
            ]
          : []
      }
    >
      <Modal.Section>
        <BlockStack gap="400">
          <InlineGrid columns={2} gap="400">
            <Card background="bg-surface-secondary">
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued" textTransform="uppercase">
                  Referrer (Customer A)
                </Text>
                <Text variant="bodyMd" as="p" fontWeight="semibold">
                  {item.senderName}
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  {item.senderEmail}
                </Text>
                {item.referrerCustomerId && (
                  <Text variant="bodySm" as="p" tone="subdued">
                    Shopify Customer ID: {item.referrerCustomerId}
                  </Text>
                )}
              </BlockStack>
            </Card>

            <Card background="bg-surface-secondary">
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued" textTransform="uppercase">
                  Friend (Customer B)
                </Text>
                <Text variant="bodyMd" as="p" fontWeight="semibold">
                  {item.receiverName}
                </Text>
                <Text variant="bodySm" as="p" tone="subdued">
                  {item.receiverEmail}
                </Text>
                {item.referredCustomerId && (
                  <Text variant="bodySm" as="p" tone="subdued">
                    Shopify Customer ID: {item.referredCustomerId}
                  </Text>
                )}
              </BlockStack>
            </Card>
          </InlineGrid>

          <Divider />

          <BlockStack gap="300">
            <Text variant="headingSm" as="h3" tone="subdued" textTransform="uppercase">
              Referred Product & Tracking Token
            </Text>
            <InlineGrid columns={2} gap="400">
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="span">Product Title</Text>
                <Text variant="bodyMd" fontWeight="bold" as="span">
                  {item.productTitle || "Referred Product"}
                </Text>
                {item.productId && (
                  <Text variant="bodySm" tone="subdued" as="span">
                    Product ID: {item.productId}
                  </Text>
                )}
              </BlockStack>

              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="span">Reward Snapshot</Text>
                <Text variant="bodyMd" fontWeight="bold" tone="magic" as="span">
                  {rewardDisplay}
                </Text>
                <Text variant="bodySm" tone="subdued" as="span">
                  (Locked at referral creation time)
                </Text>
              </BlockStack>
            </InlineGrid>

            {item.token && (
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text variant="bodySm" tone="subdued" as="span">Referral Tracking Token:</Text>
                    <Text variant="bodyMd" fontWeight="bold" as="span">
                      <code>{item.token}</code>
                    </Text>
                  </BlockStack>
                  {item.productUrl && (
                    <Button
                      size="slim"
                      url={item.productUrl}
                      target="_blank"
                      external
                    >
                      Visit Product Link
                    </Button>
                  )}
                </InlineStack>
              </Box>
            )}
          </BlockStack>

          <Divider />

          <BlockStack gap="300">
            <Text variant="headingSm" as="h3" tone="subdued" textTransform="uppercase">
              Lifecycle & Reward Issuance
            </Text>
            <InlineGrid columns={2} gap="400">
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="span">Order Status</Text>
                <InlineStack>
                  <Badge tone={getStatusTone(item.orderStatus)}>
                    {item.orderStatus || "Pending"}
                  </Badge>
                </InlineStack>
              </BlockStack>

              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued" as="span">Reward Status</Text>
                <InlineStack>
                  <Badge tone={item.rewardIssued || item.rewardStatus === "Rewarded" || item.rewardStatus === "Redeemed" ? "success" : "attention"}>
                    {item.rewardStatus || "Not Rewarded"}
                  </Badge>
                </InlineStack>
              </BlockStack>
            </InlineGrid>

            {item.discountCode && (
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued" as="span">Issued Shopify Discount Code:</Text>
                  <Text variant="headingMd" fontWeight="bold" tone="success" as="p">
                    <code>{item.discountCode}</code>
                  </Text>
                  {item.discountAmount && (
                    <Text variant="bodySm" as="span">Value: {item.discountAmount}</Text>
                  )}
                  {item.discountId && (
                    <Text variant="bodySm" tone="subdued" as="span">Shopify Discount ID: {item.discountId}</Text>
                  )}
                </BlockStack>
              </Box>
            )}

            {(item.orderNumber || item.referredOrderNumber) && (
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued" as="span">Referred Purchase Order Details:</Text>
                  <Text variant="bodyMd" fontWeight="bold" as="p">
                    Order {item.referredOrderNumber || item.orderNumber}
                  </Text>
                  {item.paymentStatus && (
                    <Text variant="bodySm" as="span">Payment Status: <strong>{item.paymentStatus}</strong></Text>
                  )}
                  {item.orderAmount && (
                    <Text variant="bodySm" as="span">Total: ${item.orderAmount}</Text>
                  )}
                </BlockStack>
              </Box>
            )}

            {item.redeemedAt && (
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued" as="span">Reward Redemption:</Text>
                  <Text variant="bodyMd" fontWeight="semibold" tone="success" as="p">
                    Redeemed on {new Date(item.redeemedAt).toLocaleDateString()}
                  </Text>
                  {item.redeemingOrderNumber && (
                    <Text variant="bodySm" as="span">In Order: {item.redeemingOrderNumber}</Text>
                  )}
                </BlockStack>
              </Box>
            )}

            {item.discountCode && onRetryEmail && (
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text variant="bodySm" fontWeight="semibold" as="span">Reward Email Delivery</Text>
                    <Text variant="bodySm" tone="subdued" as="span">
                      Recipient: <strong>{item.senderEmail}</strong> ({item.rewardEmailSent ? "Delivered" : "Delivery Pending/Retryable"})
                    </Text>
                  </BlockStack>
                  <Button
                    onClick={() => onRetryEmail(item.id)}
                    loading={isRetryingEmail}
                  >
                    Resend Reward Email
                  </Button>
                </InlineStack>
              </Box>
            )}

            {isPendingOrUnpaid && onReconcile && (
              <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text variant="bodySm" fontWeight="semibold" as="span">Need to verify Shopify purchase?</Text>
                    <Text variant="bodySm" tone="subdued" as="span">
                      Check recent Shopify orders for Friend B ({item.receiverEmail}) or token ({item.token}).
                    </Text>
                  </BlockStack>
                  <Button
                    onClick={() => onReconcile(item.id)}
                    loading={isReconciling}
                  >
                    Sync Order
                  </Button>
                </InlineStack>
              </Box>
            )}
          </BlockStack>

          {item.message && (
            <>
              <Divider />
              <BlockStack gap="100">
                <Text variant="headingSm" as="h3" tone="subdued" textTransform="uppercase">
                  Sender Custom Message
                </Text>
                <Box background="bg-surface-secondary" padding="300" borderRadius="100">
                  <Text as="p" fontStyle="italic" tone="subdued">
                    &quot;{item.message}&quot;
                  </Text>
                </Box>
              </BlockStack>
            </>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

ProductDetailModal.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    token: PropTypes.string,
    productId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    referrerCustomerId: PropTypes.string,
    referredCustomerId: PropTypes.string,
    senderName: PropTypes.string,
    senderEmail: PropTypes.string,
    receiverName: PropTypes.string,
    receiverEmail: PropTypes.string,
    productTitle: PropTypes.string,
    productUrl: PropTypes.string,
    rewardType: PropTypes.string,
    rewardValue: PropTypes.string,
    discountCode: PropTypes.string,
    discountId: PropTypes.string,
    discountAmount: PropTypes.string,
    orderStatus: PropTypes.string,
    rewardStatus: PropTypes.string,
    rewardIssued: PropTypes.bool,
    rewardEmailSent: PropTypes.bool,
    orderId: PropTypes.string,
    orderNumber: PropTypes.string,
    referredOrderNumber: PropTypes.string,
    paymentStatus: PropTypes.string,
    orderAmount: PropTypes.string,
    redeemedAt: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    redeemingOrderNumber: PropTypes.string,
    message: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
  onReconcile: PropTypes.func,
  isReconciling: PropTypes.bool,
  onRetryEmail: PropTypes.func,
  isRetryingEmail: PropTypes.bool,
};
