import React, { useState } from "react";
import Button from "@material-ui/core/Button";
import Dialog from "@material-ui/core/Dialog";
import DialogTitle from "@material-ui/core/DialogTitle";
import DialogContent from "@material-ui/core/DialogContent";
import DialogActions from "@material-ui/core/DialogActions";
import Typography from "@material-ui/core/Typography";

export default function PatternButton({
  rules,
  buttonLabel = "Patterns",
  dialogTitle = "Patterns",
  size = "small",
  buttonStyle,
}) {
  const [open, setOpen] = useState(false);

  if (!rules || rules.length === 0) return null;

  return (
    <>
      <Button
        size={size}
        variant="outlined"
        color="primary"
        style={buttonStyle}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {buttonLabel}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent>
          {rules.map((rule, i) => (
            <Typography key={i} paragraph style={{ whiteSpace: "pre-wrap" }}>
              {rule?.rule_les_num
                ? `Pattern ${rule.rule_les_num}: `
                : "Pattern: "}
              {rule?.rule || ""}
            </Typography>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
