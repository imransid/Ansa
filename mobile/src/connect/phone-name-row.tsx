import { useState } from "react";
import { InlineChange } from "../components/inline-change";
import { TextField } from "../components/text-field";
import { PHONE_NAME_MAX_LENGTH } from "../pairing/phone-defaults";

type PhoneNameRowProps = {
  name: string;
  onChange: (name: string) => void;
};

// The name ansa's website lists this phone by: the phone's own name unless
// changed here, before connecting.
export function PhoneNameRow({ name, onChange }: PhoneNameRowProps) {
  const [editing, setEditing] = useState(false);
  if (!editing) return <InlineChange label="This phone's name" value={name} onChange={() => setEditing(true)} />;
  return (
    <TextField
      label="This phone's name"
      value={name}
      onChangeText={onChange}
      maxLength={PHONE_NAME_MAX_LENGTH}
      autoCorrect={false}
      returnKeyType="done"
      onSubmitEditing={() => setEditing(false)}
      hint="How ansa's website lists this phone, so you can tell your phones apart."
    />
  );
}
