import { useCallback, useEffect, useState } from "react";

import Layout from "layout";
import axiosClient from "utils/AxiosClient";
import CustomInput from "components/CustomInput";
import ImageUpload from "components/ImageUpload";
import ToggleSwitch from "components/ToggleSwitch";
import Badge from "components/Badge";
import PrimaryBtn from "components/PrimaryBtn";
import SubmitBtn from "components/SubmitBtn";
import RedBtn from "components/RedBtn";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "components/Table";
import { useDialog } from "components/dialog/DialogContext";
import formatArabicDate from "utils/formatArabicDate";

const safeValue = (value, fallback = "—") =>
  value === null || value === undefined || value === "" ? fallback : value;

const FIELD_TYPES = [
  { value: "text", label: "نص" },
  { value: "phone", label: "رقم هاتف" },
  { value: "number", label: "رقم" },
];

const paymentMethodColumns = [
  { key: "icon", label: "الأيقونة", width: "80px" },
  { key: "label", label: "الاسم المعروض" },
  { key: "name", label: "المعرّف" },
  { key: "deposit", label: "حدود الشحن" },
  { key: "status", label: "الحالة" },
  { key: "createdAt", label: "التاريخ" },
  { key: "actions", label: "إجراءات", className: "text-left" },
];

const translatePaymentMethodError = (code, fallback) => {
  const map = {
    PAYMENT_METHOD_NAME_REQUIRED: "المعرّف مطلوب.",
    PAYMENT_METHOD_NAME_TAKEN: "هذا المعرّف مستخدم من قبل.",
    PAYMENT_METHOD_LABEL_REQUIRED: "الاسم المعروض مطلوب.",
    PAYMENT_METHOD_ICON_REQUIRED: "أيقونة وسيلة الدفع مطلوبة.",
    PAYMENT_METHOD_MIN_DEPOSIT_INVALID: "الحد الأدنى للشحن غير صالح.",
    PAYMENT_METHOD_MAX_DEPOSIT_INVALID:
      "الحد الأقصى للشحن يجب أن يكون أكبر من الحد الأدنى.",
    PAYMENT_METHOD_FIELDS_INVALID: "بيانات الحقول المطلوبة غير صالحة.",
    PAYMENT_METHOD_NOT_FOUND: "وسيلة الدفع غير موجودة.",
  };
  return map[code] || fallback || code || "حدث خطأ. حاول مرة أخرى.";
};

const emptyField = () => ({
  key: "",
  label: "",
  type: "text",
  required: true,
});

const FieldsEditor = ({ fields, onChange }) => {
  const updateField = (index, patch) => {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };
  const removeField = (index) => {
    onChange(fields.filter((_, i) => i !== index));
  };
  const addField = () => {
    onChange([...fields, emptyField()]);
  };

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-slate-600">
        الحقول المطلوبة عند الدفع
      </span>
      <div className="space-y-2">
        {fields.map((field, index) => (
          <div
            key={index}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2"
          >
            <input
              type="text"
              dir="ltr"
              placeholder="key (مثال: customer_mobile)"
              value={field.key}
              onChange={(e) => updateField(index, { key: e.target.value })}
              className="w-40 rounded-lg border border-slate-200 px-2 py-1 text-xs"
            />
            <input
              type="text"
              placeholder="التسمية المعروضة"
              value={field.label}
              onChange={(e) => updateField(index, { label: e.target.value })}
              className="w-36 rounded-lg border border-slate-200 px-2 py-1 text-xs"
            />
            <select
              value={field.type}
              onChange={(e) => updateField(index, { type: e.target.value })}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) =>
                  updateField(index, { required: e.target.checked })
                }
              />
              إلزامي
            </label>
            <button
              type="button"
              onClick={() => removeField(index)}
              className="mr-auto rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
            >
              حذف
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addField}
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
      >
        + إضافة حقل
      </button>
    </div>
  );
};

const PaymentMethodForm = ({ initialValues, onSubmit, onCancel, submitLabel }) => {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [label, setLabel] = useState(initialValues?.label ?? "");
  const [icon, setIcon] = useState(null);
  const [minDeposit, setMinDeposit] = useState(
    initialValues?.minDeposit?.toString() ?? "",
  );
  const [maxDeposit, setMaxDeposit] = useState(
    initialValues?.maxDeposit?.toString() ?? "",
  );
  const [active, setActive] = useState(initialValues?.active ?? true);
  const [fields, setFields] = useState(initialValues?.fields ?? []);
  const [dialogError, setDialogError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <div className="min-w-70 p-2">
      <h2 className="text-base font-semibold text-slate-800">
        {initialValues ? "تعديل وسيلة الدفع" : "إنشاء وسيلة دفع جديدة"}
      </h2>
      <div className="mt-4 space-y-3">
        <ImageUpload
          label="الأيقونة"
          value={icon}
          onChange={setIcon}
          existingUrl={initialValues?.iconPath ?? ""}
        />
        <CustomInput
          label="المعرّف (كما هو عند Dpay، مثال: edfali)"
          dir="ltr"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="edfali"
        />
        <CustomInput
          label="الاسم المعروض"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="مثال: إدفعلي"
        />
        <div className="flex gap-3">
          <CustomInput
            label="الحد الأدنى للشحن"
            dir="ltr"
            type="number"
            value={minDeposit}
            onChange={(event) => setMinDeposit(event.target.value)}
            placeholder="1"
          />
          <CustomInput
            label="الحد الأقصى للشحن"
            dir="ltr"
            type="number"
            value={maxDeposit}
            onChange={(event) => setMaxDeposit(event.target.value)}
            placeholder="5000"
          />
        </div>
        <FieldsEditor fields={fields} onChange={setFields} />
        <ToggleSwitch label="مفعّل" checked={active} onChange={setActive} />
      </div>
      {dialogError && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {dialogError}
        </div>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          إلغاء
        </button>
        <SubmitBtn
          onClick={async () => {
            if (!name.trim()) {
              setDialogError("المعرّف مطلوب.");
              return;
            }
            if (!label.trim()) {
              setDialogError("الاسم المعروض مطلوب.");
              return;
            }
            if (!initialValues && !icon) {
              setDialogError("أيقونة وسيلة الدفع مطلوبة.");
              return;
            }
            const parsedMin = Number(minDeposit);
            const parsedMax = Number(maxDeposit);
            if (!Number.isFinite(parsedMin) || parsedMin < 0) {
              setDialogError("الحد الأدنى للشحن غير صالح.");
              return;
            }
            if (!Number.isFinite(parsedMax) || parsedMax <= parsedMin) {
              setDialogError("الحد الأقصى للشحن يجب أن يكون أكبر من الحد الأدنى.");
              return;
            }
            for (const field of fields) {
              if (!field.key.trim() || !field.label.trim()) {
                setDialogError("كل حقل يجب أن يحتوي على key وتسمية.");
                return;
              }
            }

            setIsSubmitting(true);
            setDialogError("");
            const result = await onSubmit({
              name,
              label,
              icon,
              minDeposit: parsedMin,
              maxDeposit: parsedMax,
              active,
              fields,
            });
            if (result?.ok) {
              onCancel();
            } else if (result?.error) {
              setDialogError(result.error);
            }
            setIsSubmitting(false);
          }}
          disabled={isSubmitting}
        >
          {submitLabel}
        </SubmitBtn>
      </div>
    </div>
  );
};

const PaymentMethods = () => {
  const { openDialog, closeDialog } = useDialog();
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [deleteId, setDeleteId] = useState(null);

  const fetchPaymentMethods = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await axiosClient.get("/payment-methods");
      const payload = response.data ?? {};
      setPaymentMethods(
        Array.isArray(payload.paymentMethods) ? payload.paymentMethods : [],
      );
    } catch (err) {
      setError("تعذر تحميل وسائل الدفع. حاول مرة أخرى.");
      setPaymentMethods([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPaymentMethods();
  }, [fetchPaymentMethods]);

  const buildFormData = ({
    name,
    label,
    icon,
    minDeposit,
    maxDeposit,
    active,
    fields,
  }) => {
    const formData = new FormData();
    formData.append("name", name.trim());
    formData.append("label", label.trim());
    formData.append("minDeposit", String(minDeposit));
    formData.append("maxDeposit", String(maxDeposit));
    formData.append("active", String(active));
    formData.append("fields", JSON.stringify(fields));
    if (icon) {
      formData.append("icon", icon);
    }
    return formData;
  };

  const handleCreate = async (values) => {
    setError("");
    setSuccessMessage("");
    try {
      await axiosClient.post("/payment-methods", buildFormData(values));
      await fetchPaymentMethods();
      setSuccessMessage("تم إنشاء وسيلة الدفع بنجاح.");
      return { ok: true };
    } catch (err) {
      const code = err?.response?.data?.code;
      return {
        ok: false,
        error: translatePaymentMethodError(
          code,
          "تعذر إنشاء وسيلة الدفع. حاول مرة أخرى.",
        ),
      };
    }
  };

  const handleUpdate = async (id, values) => {
    setError("");
    setSuccessMessage("");
    try {
      await axiosClient.patch("/payment-methods", buildFormData(values), {
        params: { id },
      });
      await fetchPaymentMethods();
      setSuccessMessage("تم تعديل وسيلة الدفع بنجاح.");
      return { ok: true };
    } catch (err) {
      const code = err?.response?.data?.code;
      return {
        ok: false,
        error: translatePaymentMethodError(
          code,
          "تعذر تعديل وسيلة الدفع. حاول مرة أخرى.",
        ),
      };
    }
  };

  const handleDelete = async (id) => {
    setDeleteId(id);
    setError("");
    setSuccessMessage("");
    try {
      await axiosClient.delete("/payment-methods", { params: { id } });
      await fetchPaymentMethods();
      setSuccessMessage("تم حذف وسيلة الدفع بنجاح.");
      return { ok: true };
    } catch (err) {
      const code = err?.response?.data?.code;
      const translated = translatePaymentMethodError(
        code,
        "تعذر حذف وسيلة الدفع. حاول مرة أخرى.",
      );
      setError(translated);
      return { ok: false, error: translated };
    } finally {
      setDeleteId(null);
    }
  };

  const handleOpenCreateDialog = () => {
    openDialog(
      <PaymentMethodForm
        onSubmit={handleCreate}
        onCancel={closeDialog}
        submitLabel="إنشاء"
      />,
    );
  };

  const handleOpenEditDialog = (paymentMethod) => {
    openDialog(
      <PaymentMethodForm
        initialValues={paymentMethod}
        onSubmit={(values) => handleUpdate(paymentMethod._id, values)}
        onCancel={closeDialog}
        submitLabel="حفظ"
      />,
    );
  };

  const handleOpenDeleteDialog = (paymentMethod) => {
    openDialog(
      <div className="min-w-70 p-2">
        <h2 className="text-base font-semibold text-slate-800">
          تأكيد حذف وسيلة الدفع
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          هل أنت متأكد أنك تريد حذف هذه الوسيلة؟ لا يمكن التراجع عن ذلك.
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            onClick={closeDialog}
          >
            إلغاء
          </button>
          <RedBtn
            onClick={async () => {
              closeDialog();
              await handleDelete(paymentMethod._id);
            }}
            disabled={deleteId === paymentMethod._id}
          >
            حذف
          </RedBtn>
        </div>
      </div>,
    );
  };

  return (
    <Layout>
      <div className="px-4 py-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-800">
              وسائل الدفع
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              وسائل شحن الرصيد المتاحة لحسابات الأفراد عبر Dpay
            </p>
          </div>
          <PrimaryBtn onClick={handleOpenCreateDialog}>
            إنشاء وسيلة دفع جديدة
          </PrimaryBtn>
        </div>

        {successMessage && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
            {successMessage}
          </div>
        )}

        <div className="mt-6">
          {isLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-8 text-center text-sm text-slate-600">
              جاري تحميل وسائل الدفع...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-700">
              {error}
            </div>
          ) : paymentMethods.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-8 text-center text-sm text-slate-600">
              لا توجد وسائل دفع حتى الآن.
            </div>
          ) : (
            <Table columns={paymentMethodColumns}>
              <TableHead columns={paymentMethodColumns} />
              <TableBody>
                {paymentMethods.map((paymentMethod) => (
                  <TableRow key={paymentMethod._id}>
                    <TableCell>
                      <img
                        src={paymentMethod.iconPath}
                        alt={paymentMethod.label}
                        className="mx-auto h-10 w-10 rounded-lg object-contain"
                      />
                    </TableCell>
                    <TableCell>{safeValue(paymentMethod.label)}</TableCell>
                    <TableCell dir="ltr">{safeValue(paymentMethod.name)}</TableCell>
                    <TableCell dir="ltr">
                      {safeValue(paymentMethod.minDeposit)} -{" "}
                      {safeValue(paymentMethod.maxDeposit)}
                    </TableCell>
                    <TableCell>
                      <Badge tone={paymentMethod.active ? "success" : "danger"}>
                        {paymentMethod.active ? "مفعّل" : "غير مفعّل"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {paymentMethod.createdAt
                        ? formatArabicDate(paymentMethod.createdAt)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          onClick={() => handleOpenEditDialog(paymentMethod)}
                        >
                          تعديل
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                          onClick={() => handleOpenDeleteDialog(paymentMethod)}
                          disabled={deleteId === paymentMethod._id}
                        >
                          حذف
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default PaymentMethods;
