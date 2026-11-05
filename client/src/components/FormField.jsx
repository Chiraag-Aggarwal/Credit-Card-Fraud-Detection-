export default function FormField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  placeholder,
  required = true,
  minLength,
  error,
}) {
  return (
    <div>
      <label className="block text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={error ? id + '-error' : undefined}
        aria-invalid={Boolean(error)}
        autoComplete={autoComplete}
        className="field-input mt-2 w-full"
        id={id}
        minLength={minLength}
        name={id}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        type={type}
        value={value}
      />
      {error && (
        <p className="field-error mt-1.5 text-xs font-medium" id={id + '-error'}>
          {error}
        </p>
      )}
    </div>
  )
}
