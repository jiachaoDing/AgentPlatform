import Form from "@rjsf/shadcn";
import validator from "@rjsf/validator-ajv8";
import type { RJSFSchema } from "@rjsf/utils";
import { Button } from "@agent-platform/ui/components/button";
import { useState } from "react";

export function ToolParameterForm({
  schema,
  onSubmit,
  disabled = false,
}: {
  schema: RJSFSchema;
  onSubmit(data: unknown): Promise<void>;
  disabled?: boolean;
}) {
  const [jsonMode, setJsonMode] = useState(false);
  const [data, setData] = useState<unknown>({});
  const [json, setJson] = useState("{}");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async (value: unknown) => {
    setPending(true);
    setError("");
    try {
      await onSubmit(value);
    } catch {
      setError("参数提交失败，请检查输入并重试。");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="tool-form">
      <div className="panel-toolbar">
        <span>工具参数</span>
        <Button
          variant="outline"
          onClick={() => {
            if (!jsonMode) setJson(JSON.stringify(data, null, 2));
            setJsonMode(!jsonMode);
            setError("");
          }}
        >
          {jsonMode ? "表单输入" : "JSON 输入"}
        </Button>
      </div>
      {jsonMode ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const parsed: unknown = JSON.parse(json);
              if (!validator.isValid(schema, parsed as never, schema)) {
                setError("参数不符合工具要求。");
                return;
              }
              setData(parsed);
              void submit(parsed);
            } catch {
              setError("请输入有效的 JSON。");
            }
          }}
        >
          <label htmlFor="tool-json" className="sr-only">
            JSON 参数
          </label>
          <textarea
            id="tool-json"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={9}
            disabled={disabled || pending}
          />
          <Button type="submit" disabled={disabled || pending}>
            提交参数
          </Button>
        </form>
      ) : (
        <Form
          schema={schema}
          validator={validator}
          formData={data}
          disabled={disabled || pending}
          onChange={(event) => setData(event.formData)}
          onSubmit={(event) => {
            void submit(event.formData);
          }}
        >
          <Button type="submit" disabled={disabled || pending}>
            {pending ? "提交中…" : "提交参数"}
          </Button>
        </Form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
