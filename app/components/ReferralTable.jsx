import PropTypes from "prop-types";
import {
  IndexTable,
  Badge,
  Button,
  EmptyState,
  useIndexResourceState,
  Text,
} from "@shopify/polaris";

const formatTitleCase = (str) => {
  if (!str) return "";
  return str
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export function ReferralTable({ referrals = [] }) {
  const { selectedResources } = useIndexResourceState(referrals);

  // Map each orderStatus to a Polaris badge tone and a display label
  const getStatusBadge = (orderStatus) => {
    const s = (orderStatus || "Pending").toLowerCase();
    if (s === "reward redeemed" || s === "redeemed") {
      return { tone: "success", label: "Reward Redeemed" };
    }
    if (s === "reward issued" || s === "ordered" || s === "completed") {
      return { tone: "success", label: "Reward Issued" };
    }
    if (s === "paid") {
      return { tone: "info", label: "Paid" };
    }
    if (s === "purchased") {
      return { tone: "warning", label: "Purchased (Pending Payment)" };
    }
    if (s === "pending") {
      return { tone: "attention", label: "Pending" };
    }
    if (s === "cancelled") {
      return { tone: "critical", label: "Cancelled" };
    }
    if (s === "refunded") {
      return { tone: "critical", label: "Refunded" };
    }
    return { tone: "info", label: formatTitleCase(orderStatus) };
  };

  const rowMarkup = referrals.map((row, index) => {
    const { tone, label } = getStatusBadge(row.orderStatus);

    return (
      <IndexTable.Row
        id={row.id.toString()}
        key={row.id}
        selected={selectedResources.includes(row.id.toString())}
        position={index}
      >
        {/* 1. ID */}
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            #{row.id}
          </Text>
        </IndexTable.Cell>

        {/* 2. Sender Name */}
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="semibold" as="span">
            {formatTitleCase(row.senderName) || "—"}
          </Text>
        </IndexTable.Cell>

        {/* 3. Sender Email */}
        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            {row.senderEmail || "—"}
          </Text>
        </IndexTable.Cell>

        {/* 4. Receiver Name */}
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="semibold" as="span">
            {formatTitleCase(row.receiverName) || "—"}
          </Text>
        </IndexTable.Cell>

        {/* 5. Receiver Email */}
        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            {row.receiverEmail || "—"}
          </Text>
        </IndexTable.Cell>

        {/* 6. Order Status */}
        <IndexTable.Cell>
          <Badge tone={tone}>{label}</Badge>
        </IndexTable.Cell>

        {/* 7. Action */}
        <IndexTable.Cell>
          {row.productUrl ? (
            <Button size="slim" url={row.productUrl} target="_blank" external>
              View Product
            </Button>
          ) : (
            <Text tone="subdued" as="span">
              —
            </Text>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const emptyStateMarkup = (
    <EmptyState
      heading="No referral records found"
      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
    >
      <p>When customers refer products to their friends, they&apos;ll show up here.</p>
    </EmptyState>
  );

  return (
    <div className="dah-referral-table-container">
      <div className="dah-section-header" style={{ marginBottom: "20px" }}>
        <div className="dah-section-title-group">
          <h2 className="dah-section-title">Product Referral Tracking</h2>
          <p className="dah-section-subtitle">
            Monitor customer referrals, friend purchases, order statuses, and referral actions.
          </p>
        </div>
      </div>

      <div className="dah-table-wrapper">
        <IndexTable
          selectable={false}
          resourceName={{ singular: "referral", plural: "referrals" }}
          itemCount={referrals.length}
          emptyState={emptyStateMarkup}
          headings={[
            { title: "ID" },
            { title: "Sender Name" },
            { title: "Sender Email" },
            { title: "Receiver Name" },
            { title: "Receiver Email" },
            { title: "Order Status" },
            { title: "Action" },
          ]}
        >
          {rowMarkup}
        </IndexTable>
      </div>
    </div>
  );
}

ReferralTable.propTypes = {
  referrals: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      senderName: PropTypes.string,
      senderEmail: PropTypes.string,
      receiverName: PropTypes.string,
      receiverEmail: PropTypes.string,
      productTitle: PropTypes.string,
      productUrl: PropTypes.string,
      productId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      rewardType: PropTypes.string,
      rewardValue: PropTypes.string,
      orderStatus: PropTypes.string,
      discountCode: PropTypes.string,
    })
  ),
};
