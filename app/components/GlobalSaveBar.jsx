import { SaveBar } from "@shopify/app-bridge-react";
import { useSaveBar } from "../context/SaveBarContext";

export function GlobalSaveBar() {
  const { isDirty, isSaving, triggerSave, triggerDiscard } = useSaveBar();

  return (
    <SaveBar id="global-save-bar" open={isDirty}>
      <button
        variant="primary"
        onClick={triggerSave}
        loading={isSaving ? "" : undefined}
        disabled={isSaving ? "" : undefined}
      >
        Save
      </button>
      <button
        onClick={triggerDiscard}
        disabled={isSaving ? "" : undefined}
      >
        Discard
      </button>
    </SaveBar>
  );
}

