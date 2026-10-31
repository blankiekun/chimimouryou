package android.graphics;

import android.annotation.NonNull;
import java.awt.Graphics2D;
import java.awt.Rectangle;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.List;

public final class Canvas {
    private BufferedImage canvasImage;
    private Graphics2D canvas;
    private List<AffineTransform> transformStack = new ArrayList<AffineTransform>();

    private static final String TAG = "Canvas";

    public Canvas(Bitmap bitmap) {
        canvasImage = bitmap.getImage();
        canvas = canvasImage.createGraphics();
    }

    public void drawBitmap(Bitmap sourceBitmap, Rect src, Rect dst, Paint paint) {
        BufferedImage sourceImage = sourceBitmap.getImage();
        BufferedImage sourceImageCropped = sourceImage.getSubimage(src.left, src.top, src.getWidth(), src.getHeight());
        canvas.drawImage(sourceImageCropped, dst.left, dst.top, dst.getWidth(), dst.getHeight(), null);
    }

    public void drawBitmap(Bitmap sourceBitmap, float left, float top, Paint paint) {
        BufferedImage sourceImage = sourceBitmap.getImage();
        canvas.drawImage(sourceImage, null, (int) left, (int) top);
    }

    public void translate(float dx, float dy) {
        if (dx == 0.0f && dy == 0.0f) return;
        // TODO: check this, should translations stack?
        canvas.translate(dx, dy);
    }

    public void scale(float sx, float sy) {
        if (sx == 1.0f && sy == 1.0f) return;
        canvas.scale(sx, sy);
    }

    public final void scale(float sx, float sy, float px, float py) {
        if (sx == 1.0f && sy == 1.0f) return;
        translate(px, py);
        scale(sx, sy);
        translate(-px, -py);
    }

    public void rotate(float degrees) {
        if (degrees == 0.0f) return;
        canvas.rotate(degrees);
    }

    public final void rotate(float degrees, float px, float py) {
        if (degrees == 0.0f) return;
        canvas.rotate(degrees, px, py);
    }

    public int getSaveCount() {
        return transformStack.size();
    }

    public int save() {
        transformStack.add(canvas.getTransform());
        return getSaveCount();
    }

    public void restoreToCount(int saveCount) {
        if (saveCount < 1) {
            throw new IllegalArgumentException(
                    "Underflow in restoreToCount - more restores than saves");
        }
        if (saveCount > getSaveCount()) {
            throw new IllegalArgumentException("Overflow in restoreToCount");

        }
        AffineTransform ts = transformStack.get(saveCount - 1);
        canvas.setTransform(ts);
        while (transformStack.size() >= saveCount) {
            transformStack.remove(transformStack.size() - 1);
        }
    }

    public void restore() {
        restoreToCount(getSaveCount());
    }

    public boolean getClipBounds(@NonNull Rect bounds) {
        Rectangle r = canvas.getClipBounds();
        if (r == null) {
            bounds.left = 0;
            bounds.top = 0;
            bounds.right = canvasImage.getWidth();
            bounds.bottom = canvasImage.getHeight();
            return true;
        }
        bounds.left = r.x;
        bounds.top = r.y;
        bounds.right = r.x + r.width;
        bounds.bottom = r.y + r.height;
        return r.width != 0 && r.height != 0;
    }

}
