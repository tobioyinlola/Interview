import { useState } from "react";

import { API_BASE_URL } from "../../api/client";
import { APP_SHELL, authInit } from "../../api/session";

/** The transcript as a file. On the website it is a plain link (the browser sends the sign-in
 *  cookie). In the installed apps there is no cookie, so the file is fetched with the app's token
 *  and then saved, or shared on a phone. */
export function TranscriptLink({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = `${API_BASE_URL}/api/sessions/${id}/transcript.txt`;
  if (!APP_SHELL)
    return (
      <a href={url} className={className}>
        Download transcript
      </a>
    );
  const save = async () => {
    setFailed(false);
    try {
      const res = await fetch(url, authInit());
      if (!res.ok) throw new Error("download failed");
      const file = new File([await res.blob()], "transcript.txt", {
        type: "text/plain",
      });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
      const href = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = href;
      a.download = "transcript.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // closed the share sheet
      setFailed(true);
    }
  };
  return (
    <>
      <button type="button" className={className} onClick={() => void save()}>
        Download transcript
      </button>
      {failed && (
        <span role="alert" className="text-sm text-red-700">
          Couldn&apos;t download it. Check your connection.
        </span>
      )}
    </>
  );
}
