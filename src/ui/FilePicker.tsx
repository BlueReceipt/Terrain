import { useRef } from 'preact/hooks';

/** A button that opens the file picker. */
export function FilePicker({
  label,
  accept,
  primary = true,
  onFile,
}: {
  label: string;
  accept: string;
  primary?: boolean;
  onFile: (file: File) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        class={primary ? 'button primary' : 'button'}
        onClick={() => picker.current?.click()}
      >
        {label}
      </button>
      <input
        ref={picker}
        type="file"
        accept={accept}
        class="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}
