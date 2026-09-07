import { createContext, useContext, useState, useCallback, useRef } from "react";
import PropTypes from "prop-types";

const SaveBarContext = createContext({
  isDirty: false,
  isSaving: false,
  setDirty: () => {},
  setIsSaving: () => {},
  registerHandlers: () => {},
  unregisterHandlers: () => {},
  triggerSave: async () => {},
  triggerDiscard: () => {},
});

export function SaveBarProvider({ children }) {
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handlersRef = useRef({
    onSave: null,
    onDiscard: null,
  });

  const registerHandlers = useCallback(({ onSave, onDiscard }) => {
    handlersRef.current = { onSave, onDiscard };
  }, []);

  const unregisterHandlers = useCallback(() => {
    handlersRef.current = { onSave: null, onDiscard: null };
    setIsDirty(false);
    setIsSaving(false);
  }, []);

  const setDirty = useCallback((dirty) => {
    setIsDirty(dirty);
  }, []);

  const triggerSave = useCallback(async () => {
    if (handlersRef.current.onSave) {
      setIsSaving(true);
      try {
        await handlersRef.current.onSave();
      } finally {
        setIsSaving(false);
      }
    }
  }, []);

  const triggerDiscard = useCallback(() => {
    if (handlersRef.current.onDiscard) {
      handlersRef.current.onDiscard();
    }
    setIsDirty(false);
  }, []);

  return (
    <SaveBarContext.Provider
      value={{
        isDirty,
        isSaving,
        setDirty,
        setIsSaving,
        registerHandlers,
        unregisterHandlers,
        triggerSave,
        triggerDiscard,
      }}
    >
      {children}
    </SaveBarContext.Provider>
  );
}

SaveBarProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useSaveBar() {
  return useContext(SaveBarContext);
}
