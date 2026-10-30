package com.texite.android;

import android.app.Activity;
import android.content.Intent;
import android.util.AtomicFile;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "TexiteFiles")
public class TexiteFilesPlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private byte[] exportBytes;
    private File projectDirectory() {
        File directory = new File(getContext().getFilesDir(), "projects");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("无法创建项目目录");
        return directory;
    }
    @PluginMethod public void readProjects(PluginCall call) {
        io.execute(() -> {
            try {
                JSArray projects = new JSArray();
                File[] files = projectDirectory().listFiles((dir, name) -> name.endsWith(".json"));
                if (files != null) for (File file : files) {
                    byte[] data = new AtomicFile(file).readFully();
                    projects.put(new JSObject(new String(data, StandardCharsets.UTF_8)));
                }
                call.resolve(new JSObject().put("projects", projects));
            } catch (Exception error) { call.reject("读取项目失败，现有文件未改动", error); }
        });
    }
    @PluginMethod public void saveProject(PluginCall call) {
        JSObject project = call.getObject("project");
        if (project == null) { call.reject("缺少项目数据"); return; }
        String id = project.getString("id", "");
        if (!id.matches("[a-zA-Z0-9-]{1,80}")) { call.reject("无效项目 ID"); return; }
        byte[] bytes = project.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 384 * 1024 * 1024) { call.reject("项目序列化数据超过 384 MB，请拆分项目"); return; }
        io.execute(() -> {
            AtomicFile target = null;
            FileOutputStream output = null;
            try {
                target = new AtomicFile(new File(projectDirectory(), id + ".json"));
                output = target.startWrite(); output.write(bytes); target.finishWrite(output);
                call.resolve();
            } catch (Exception error) { if (target != null) target.failWrite(output); call.reject("保存失败，请导出项目备份", error); }
        });
    }
    @PluginMethod public void exportFile(PluginCall call) {
        if (exportBytes != null) { call.reject("请先完成当前导出"); return; }
        try { exportBytes = Base64.decode(call.getString("base64", ""), Base64.DEFAULT); }
        catch (Exception error) { call.reject("导出数据无效", error); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "Texite.zip").replaceAll("[/\\\\]", "_"));
        startActivityForResult(call, intent, "exportResult");
    }
    @ActivityCallback private void exportResult(PluginCall call, ActivityResult result) {
        byte[] bytes = exportBytes; exportBytes = null;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(new JSObject().put("cancelled", true)); return;
        }
        io.execute(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (output == null || bytes == null) throw new IllegalStateException("请重试导出");
                output.write(bytes); call.resolve();
            } catch (Exception error) { call.reject("导出失败", error); }
        });
    }
    public void back() { notifyListeners("back", new JSObject()); }
    @PluginMethod public void background(PluginCall call) {
        getActivity().runOnUiThread(() -> { getActivity().moveTaskToBack(true); call.resolve(); });
    }
}
