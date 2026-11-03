// Scoped to the shadow root. `all: initial` on the host stops the page's inherited styles leaking in.
export const styles = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.launcher { position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border-radius: 50%;
  border: none; background: #9b3fe8; color: #fff; font-size: 24px; cursor: pointer;
  box-shadow: 0 6px 20px rgba(0,0,0,.2); z-index: 2147483000; }
.panel { position: fixed; right: 20px; bottom: 88px; width: 380px; max-width: calc(100vw - 40px);
  height: 560px; max-height: calc(100vh - 120px); display: none; flex-direction: column; background: #fff;
  border: 1px solid rgba(0,0,0,.12); border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.18); overflow: hidden; z-index: 2147483000; color: #000; }
.panel[data-open="true"] { display: flex; }
.header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; background: #fff; border-bottom: 1px solid rgba(0,0,0,.12); color: #000; font-weight: 400; font-size: 16px; }
.header button { margin-left: auto; background: transparent; border: none; color: #000; font-size: 20px; cursor: pointer; }
.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; font-size: 14px; line-height: 1.5; }
.msg { max-width: 85%; padding: 10px 12px; border-radius: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.user { align-self: flex-end; background: #9b3fe8; color: #fff; }
.msg.assistant { align-self: flex-start; background: #f1f1f1; color: #000; }
.msg a { color: #8e35e0; font-weight: 400; text-decoration: underline; }
.sources { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,.15); font-size: 12px; }
.sources a { display: block; color: #8e35e0; text-decoration: underline; }
.form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid rgba(0,0,0,.12); background: #fff; }
.form textarea { flex: 1; resize: none; border: 1px solid #b3b3b3; background: #fff; border-radius: 8px; padding: 8px 12px; font-size: 14px; color: #000; }
.form button { border: none; background: #9b3fe8; color: #fff; border-radius: 8px; padding: 0 16px; cursor: pointer; }
.form button:disabled { opacity: .5; cursor: default; }
`;

export const extraStyles = `
.slots { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
.slots button { text-align: left; border: 1.5px solid #9b3fe8; background: #fff; color: #8e35e0; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-weight: 400; cursor: pointer; }
.slots button:hover { background: #9b3fe8; color: #fff; }
.slots[aria-busy="true"] { opacity: .5; pointer-events: none; }
.notice { margin-top: 6px; font-size: 12px; color: #6c6b6b; }
.actions { display: flex; gap: 8px; margin-top: 8px; }
.actions button { border: 1.5px solid #9b3fe8; background: #fff; color: #8e35e0; border-radius: 8px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
.examples { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.examples button { text-align: left; border: 1px solid #b3b3b3; background: #fff; border-radius: 8px; padding: 6px 10px; font-size: 13px; cursor: pointer; color: #000; }
.msg.system { align-self: center; background: transparent; color: #6c6b6b; font-size: 12px; text-align: center; }
.header .reset { margin-left: auto; font-size: 12px; font-weight: 400; border: 1px solid rgba(0,0,0,.3); border-radius: 999px; padding: 2px 10px; }
.header .reset + button { margin-left: 4px; }
@media (max-width: 480px) {
  .panel { right: 0; bottom: 0; width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; }
}
`;
