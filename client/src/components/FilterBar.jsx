import CustomInput from "components/CustomInput";
import DateInput from "components/DateInput";
import SubmitBtn from "components/SubmitBtn";

const FIELD_COL_SPAN_CLASS = {
  1: "",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
};

const FilterField = ({ field, value, onChange }) => {
  const colSpanClass = FIELD_COL_SPAN_CLASS[field.colSpan] || "";

  if (field.type === "select") {
    return (
      <label className={`flex flex-col gap-2 text-sm text-slate-600 ${colSpanClass}`}>
        <span>{field.label}</span>
        <select
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          value={value ?? ""}
          onChange={(event) => onChange(field.key, event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "date") {
    return (
      <div className={colSpanClass}>
        <DateInput
          label={field.label}
          value={value ?? ""}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      </div>
    );
  }

  return (
    <div className={colSpanClass}>
      <CustomInput
        label={field.label}
        type={field.type === "number" ? "number" : "text"}
        min={field.type === "number" ? (field.min ?? "0") : undefined}
        placeholder={field.placeholder}
        value={value ?? ""}
        onChange={(event) => onChange(field.key, event.target.value)}
      />
    </div>
  );
};

/**
 * Generic, config-driven multi-filter form. Fields are combined into a single
 * `values` object and only applied to the parent's request once "تطبيق الفلاتر"
 * is submitted, mirroring the draft/applied filter pattern used across list pages.
 */
const FilterBar = ({
  fields,
  values,
  onChange,
  onApply,
  onClear,
  sort,
  isApplying = false,
  gridClassName = "grid gap-4 lg:grid-cols-6",
}) => (
  <div className="mt-6 rounded-2xl border border-slate-200 bg-white/80 px-4 py-4 shadow-sm">
    <form onSubmit={onApply}>
      <div className={gridClassName}>
        {fields.map((field) => (
          <FilterField
            key={field.key}
            field={field}
            value={values[field.key]}
            onChange={onChange}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {sort && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span>الفرز</span>
            <select
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={sort.value}
              onChange={sort.onChange}
            >
              {sort.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <SubmitBtn className="min-w-28" onClick={onApply} disabled={isApplying}>
          تطبيق الفلاتر
        </SubmitBtn>

        <button
          type="button"
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          onClick={onClear}
        >
          مسح الفلاتر
        </button>
      </div>
    </form>
  </div>
);

export default FilterBar;
