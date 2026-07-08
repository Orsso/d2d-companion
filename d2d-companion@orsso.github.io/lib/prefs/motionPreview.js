import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {PressMode} from '../motion/catalog.js';
import {
    buildLaunchSegments,
    interpolateTransform,
    launchDuration,
    resolveIconTransform,
    sampleLaunchSegments,
} from '../motion/transforms.js';
import {
    buildDemoSequence,
    buildEffectSequence,
    DEMO_TEMPO,
    DemoPhase,
    hoverIsActive,
    HOVER_HOLD_MS,
    NEUTRAL_HOLD_MS,
    PRE_LAUNCH_PAUSE_MS,
    SETTLE_MS,
    SWEEP_MS,
    SWEEP_SETTLE_MS,
} from './demoSequence.js';

const IDENTITY = Object.freeze({
    scaleX: 1,
    scaleY: 1,
    translationX: 0,
    translationY: 0,
    dim: 0,
});

const INLINE_ICON_SIZE = 24;
const INLINE_STEP = INLINE_ICON_SIZE + 10;

const EASINGS = Object.freeze({
    linear: Adw.Easing.LINEAR,
    'ease-out-quad': Adw.Easing.EASE_OUT_QUAD,
    'ease-out-cubic': Adw.Easing.EASE_OUT_CUBIC,
    'ease-out-back': Adw.Easing.EASE_OUT_BACK,
});

export const MotionPreview = GObject.registerClass(class MotionPreview extends Gtk.DrawingArea {
    // Given an effect ('hover', 'press', 'launch') the preview goes bare
    // and demos just that effect.
    _init({recipe, selected = false, effect = null, ...params}) {
        const inline = Boolean(effect);
        const iconCount = effect === 'hover' ? 3 : 1;
        super._init({
            height_request: inline ? 64 : 96,
            width_request: inline ? iconCount * INLINE_STEP + 22 : -1,
            hexpand: !inline,
            focusable: !inline,
            valign: inline ? Gtk.Align.CENTER : Gtk.Align.FILL,
            ...params,
        });
        this._selected = selected;
        this._effect = effect;
        this._iconCount = iconCount;
        this._recipe = this._adoptRecipe(recipe);
        this._held = false;
        this._hovered = false;
        this._pressed = false;
        this._launching = false;
        this._pressGeneration = 0;
        this._motionTransform = {...IDENTITY};
        this._launchTransform = {...IDENTITY};
        this._motionAnimation = null;
        this._launchAnimation = null;
        this._loopActive = false;
        this._loopGeneration = 0;
        this._timeoutId = 0;
        this._sweepActive = false;
        this._sweepValue = 0;
        this._sweepAnimation = null;
        this.set_draw_func((_area, cr, width, height) => {
            this._draw(cr, width, height);
        });

        this.connect('unmap', () => this.stop());
    }

    // Effect previews show the settings, not the Basics toggles.
    _adoptRecipe(recipe) {
        if (!this._effect || recipe[this._effect].enabled)
            return recipe;
        return {
            ...recipe,
            [this._effect]: {...recipe[this._effect], enabled: true},
        };
    }

    _resolveMotion() {
        return resolveIconTransform({
            position: 'bottom',
            recipe: this._recipe,
            hovered: this._hovered,
            pressed: this._pressed,
            launching: this._launching,
        });
    }

    setRecipe(recipe) {
        this._cancelLoop();
        this._pressGeneration++;
        this._motionAnimation?.reset();
        this._launchAnimation?.reset();
        this._motionAnimation = null;
        this._launchAnimation = null;
        this._pressed = false;
        this._launching = false;
        this._recipe = this._adoptRecipe(recipe);
        this._motionTransform = this._resolveMotion();
        this._launchTransform = {...IDENTITY};
        this.queue_draw();
    }

    // setRecipe without the reset: a running loop just picks the values up.
    updateRecipe(recipe) {
        this._recipe = this._adoptRecipe(recipe);
        if (this._motionAnimation?.state !== Adw.AnimationState.PLAYING)
            this._motionTransform = this._resolveMotion();
        this.queue_draw();
    }

    setSelected(selected) {
        this._selected = selected;
        this.queue_draw();
    }

    stop() {
        this._cancelLoop();
        this._held = false;
        this._pressGeneration++;
        this._motionAnimation?.reset();
        this._launchAnimation?.reset();
        this._motionAnimation = null;
        this._launchAnimation = null;
        this._hovered = false;
        this._pressed = false;
        this._launching = false;
        this._motionTransform = {...IDENTITY};
        this._launchTransform = {...IDENTITY};
        this.queue_draw();
    }

    _cancelLoop() {
        this._loopActive = false;
        this._loopGeneration++;
        this._sweepAnimation?.reset();
        this._sweepAnimation = null;
        this._sweepActive = false;
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    playLoop() {
        if (this._held || this._loopActive)
            return;
        this._loopActive = true;
        const generation = ++this._loopGeneration;
        if (this._effect) {
            this._runSequence(generation,
                () => buildEffectSequence(this._effect, this._recipe));
            return;
        }
        if (!hoverIsActive(this._recipe)) {
            this._runSequence(generation, () => buildDemoSequence(this._recipe));
            return;
        }
        this._runIntroSweep(generation, () => this._runSequence(
            generation, () => buildDemoSequence(this._recipe)));
    }

    _runIntroSweep(generation, onComplete) {
        this._sweepActive = true;
        const count = ICON_COLORS.length;
        const middle = (count - 1) / 2;
        const start = -0.6;
        const end = (count - 1) + 0.6;
        this._sweepValue = start;
        // Sweep once, then settle on the center icon.
        this._playSweepSegment(generation, start, end, SWEEP_MS,
            Adw.Easing.EASE_IN_OUT_CUBIC, () => {
                this._playSweepSegment(generation, end, middle, SWEEP_SETTLE_MS,
                    Adw.Easing.EASE_OUT_CUBIC, () => {
                        this._sweepAnimation = null;
                        this._sweepActive = false;
                        this._hovered = true;
                        this._motionTransform = resolveIconTransform({
                            position: 'bottom',
                            recipe: this._recipe,
                            hovered: true,
                        });
                        this.queue_draw();
                        onComplete();
                    });
            });
    }

    _playSweepSegment(generation, fromValue, toValue, duration, easing, onDone) {
        this._sweepAnimation?.reset();
        const target = Adw.CallbackAnimationTarget.new(value => {
            this._sweepValue = fromValue + (toValue - fromValue) * value;
            this.queue_draw();
        });
        this._sweepAnimation = Adw.TimedAnimation.new(this, 0, 1, duration, target);
        this._sweepAnimation.set_easing(easing);
        this._sweepAnimation.connect('done', () => {
            if (!this._loopActive || generation !== this._loopGeneration)
                return;
            onDone();
        });
        this._sweepAnimation.play();
    }

    stopLoop() {
        if (this._held)
            return;
        if (!this._loopActive && !this._timeoutId) {
            this._hovered = false;
            this._pressed = false;
            this._animateMotion(this._recipe.hover.duration);
            return;
        }
        this._cancelLoop();
        this._pressGeneration++;
        this._launchAnimation?.reset();
        this._launchTransform = {...IDENTITY};
        this._pressed = false;
        this._launching = false;
        this._hovered = false;
        this._animateMotion(this._recipe.hover.duration);
    }

    // Freeze in the pose the held slider edits; edits keep landing on it.
    holdPose() {
        this._cancelLoop();
        this._held = true;
        this._hovered = this._effect === 'hover';
        this._pressed = this._effect === 'press';
        this._animateMotion(this._pressed
            ? this._recipe.press.duration
            : this._recipe.hover.duration);
    }

    releasePose(resume) {
        this._held = false;
        this._hovered = false;
        this._pressed = false;
        if (resume)
            this.playLoop();
        else
            this._animateMotion(this._recipe.hover.duration);
    }

    _runSequence(generation, getPhases) {
        let phases = getPhases();
        let index = 0;
        const advance = () => {
            if (!this._loopActive || generation !== this._loopGeneration)
                return;
            if (index >= phases.length) {
                // Rebuilt every pass, so edits reshape the loop live.
                phases = getPhases();
                index = 0;
            }
            if (!phases.length)
                return;
            const phase = phases[index++];
            this._runDemoPhase(phase, generation, advance);
        };
        advance();
    }

    _runDemoPhase(phase, generation, done) {
        switch (phase) {
            case DemoPhase.HOVER_IN:
                this._hovered = true;
                this._animateMotion(this._hoverMs(), done);
                break;
            case DemoPhase.RESET:
                this._hovered = false;
                this._animateMotion(this._hoverMs(), done);
                break;
            case DemoPhase.HOLD:
                this._wait(HOVER_HOLD_MS, generation, done);
                break;
            case DemoPhase.PRE_LAUNCH_PAUSE:
                this._wait(PRE_LAUNCH_PAUSE_MS, generation, done);
                break;
            case DemoPhase.REPEAT_PAUSE:
                this._wait(this._recipe.launch.repeatPause, generation, done);
                break;
            case DemoPhase.SETTLE:
                this._wait(SETTLE_MS, generation, done);
                break;
            case DemoPhase.NEUTRAL_HOLD:
                this._wait(NEUTRAL_HOLD_MS, generation, done);
                break;
            case DemoPhase.CLICK:
                this._demoPlainClick(generation, done);
                break;
            case DemoPhase.CLICK_LAUNCH:
                this._demoClickLaunch(done);
                break;
            case DemoPhase.LAUNCH:
                this._beginLaunch({onComplete: done});
                break;
            default:
                done();
        }
    }

    _hoverMs() {
        return Math.round(this._recipe.hover.duration * DEMO_TEMPO);
    }

    _pressMs() {
        return Math.round(this._recipe.press.duration * DEMO_TEMPO);
    }

    _wait(ms, generation, done) {
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeoutId = 0;
            if (this._loopActive && generation === this._loopGeneration)
                done();
            return GLib.SOURCE_REMOVE;
        });
    }

    _demoPlainClick(generation, done) {
        this._pressed = true;
        this._animateMotion(this._pressMs(), () => {
            if (!this._loopActive || generation !== this._loopGeneration)
                return;
            this._pressed = false;
            this._animateMotion(this._pressMs(), done);
        });
    }

    _demoClickLaunch(done) {
        const press = this._recipe.press;
        if (press.enabled && press.mode === PressMode.ALL_PRIMARY_CLICKS) {
            this._pressed = true;
            this._animateMotion(this._pressMs(), () => {
                this._pressed = false;
                this._beginLaunch({ownsPressFeedback: true, onComplete: done});
            });
        } else if (press.enabled && press.mode === PressMode.LAUNCHES_ONLY) {
            this._playLaunchPressFeedback(done);
        } else {
            this._beginLaunch({onComplete: done});
        }
    }

    _animateMotion(duration, onDone = null, easing = null) {
        const from = this._motionTransform;
        const to = this._resolveMotion();
        this._motionAnimation?.reset();
        const target = Adw.CallbackAnimationTarget.new(value => {
            this._motionTransform = interpolateWithDim(from, to, value);
            this.queue_draw();
        });
        this._motionAnimation = Adw.TimedAnimation.new(this, 0, 1, duration, target);
        this._motionAnimation.set_easing(
            easing ?? EASINGS[this._recipe.hover.easing] ?? Adw.Easing.EASE_OUT_CUBIC);
        // Settle on the latest recipe; edits may land mid-flight.
        this._motionAnimation.connect('done', () => {
            this._motionTransform = this._resolveMotion();
            this.queue_draw();
            onDone?.();
        });
        this._motionAnimation.play();
    }

    _playLaunchPressFeedback(onComplete = null) {
        const generation = ++this._pressGeneration;
        this._pressed = true;
        this._animateMotion(Math.round(this._pressMs() / 2), () => {
            if (generation !== this._pressGeneration)
                return;
            this._beginLaunch({ownsPressFeedback: true, onComplete});
        });
    }

    _beginLaunch({ownsPressFeedback = false, onComplete = null} = {}) {
        if (this._launching ||
            (!this._recipe.launch.enabled && !ownsPressFeedback)) {
            onComplete?.();
            return;
        }
        this._launching = true;
        this._pressed = false;
        // Launch starts from the magnified state.
        if (this._recipe.launch.enabled) {
            this._animateMotion(
                this._recipe.hover.duration, null, Adw.Easing.EASE_OUT_CUBIC);
            this._playLaunch(onComplete);
        } else {
            this._animateMotion(this._recipe.hover.duration,
                () => this._finishLaunch(onComplete), Adw.Easing.EASE_OUT_CUBIC);
        }
    }

    _playLaunch(onComplete = null) {
        if (!this._launching || !this._recipe.launch.enabled) {
            onComplete?.();
            return;
        }
        const segments = buildLaunchSegments(
            this._recipe.launch.effect, this._recipe.launch, 'bottom');
        const duration = launchDuration(segments);
        this._launchAnimation?.reset();
        const target = Adw.CallbackAnimationTarget.new(value => {
            this._launchTransform = sampleLaunchSegments(segments, value * duration);
            this.queue_draw();
        });
        this._launchAnimation = Adw.TimedAnimation.new(this, 0, 1, duration, target);
        this._launchAnimation.set_easing(Adw.Easing.LINEAR);
        this._launchAnimation.connect('done', () => {
            this._launchTransform = {...IDENTITY};
            this._finishLaunch(onComplete);
        });
        this._launchAnimation.play();
    }

    _finishLaunch(onComplete = null) {
        if (!this._launching) {
            onComplete?.();
            return;
        }
        this._launching = false;
        this._animateMotion(this._recipe.hover.duration, onComplete);
    }

    _draw(cr, width, height) {
        if (this._effect) {
            this._drawInline(cr, width, height);
            return;
        }
        const centerX = width / 2;
        const iconSize = 18;
        const pad = 12;
        const dockHeight = 38;
        const dockWidth = Math.min(width - 14, 210);
        const dockX = centerX - dockWidth / 2;
        const dockY = height - dockHeight - 8;
        const iconTop = dockY + (dockHeight - iconSize) / 2;

        roundedRectangle(cr, 1, 1, width - 2, height - 2, 14);
        cr.setSourceRGBA(0.08, 0.09, 0.11, 1);
        cr.fillPreserve();
        cr.setLineWidth(this._selected ? 2 : 1);
        cr.setSourceRGBA(0.22, 0.52, 0.85, this._selected ? 1 : 0.28);
        cr.stroke();

        roundedRectangle(cr, dockX, dockY, dockWidth, dockHeight, 13);
        cr.setSourceRGBA(0.16, 0.17, 0.20, 0.94);
        cr.fillPreserve();
        cr.setSourceRGBA(1, 1, 1, 0.12);
        cr.setLineWidth(1);
        cr.stroke();

        const count = ICON_COLORS.length;
        const middle = (count - 1) / 2;
        const innerLeft = dockX + pad + iconSize / 2;
        const innerRight = dockX + dockWidth - pad - iconSize / 2;
        const step = (innerRight - innerLeft) / (count - 1);

        for (let i = 0; i < count; i++) {
            const transform = this._iconTransform(i, middle);
            drawIcon(cr, innerLeft + i * step, iconTop, iconSize,
                ICON_COLORS[i], transform);
        }
    }

    _drawInline(cr, width, height) {
        const count = this._iconCount;
        const middle = (count - 1) / 2;
        const iconTop = height - INLINE_ICON_SIZE - 8;
        const first = width / 2 - middle * INLINE_STEP;
        const colorOffset = (ICON_COLORS.length - count) >> 1;
        for (let i = 0; i < count; i++) {
            const transform = this._iconTransform(i, middle);
            drawIcon(cr, first + i * INLINE_STEP, iconTop, INLINE_ICON_SIZE,
                ICON_COLORS[i + colorOffset], transform);
        }
    }

    _iconTransform(index, middle) {
        if (this._sweepActive) {
            const intensity = Math.max(0, 1 - Math.abs(index - this._sweepValue));
            const hoverFull = resolveIconTransform({
                position: 'bottom',
                recipe: this._recipe,
                hovered: true,
            });
            return interpolateTransform(IDENTITY, hoverFull, intensity);
        }
        const distance = Math.abs(index - middle);
        if (distance === 0)
            return combineTransforms(this._motionTransform, this._launchTransform);
        if (distance === 1) {
            return resolveIconTransform({
                position: 'bottom',
                recipe: this._recipe,
                launching: this._launching,
                neighborHovered: this._hovered,
            });
        }
        return IDENTITY;
    }
});

const REFERENCE_ICON_SIZE = 46;

const ICON_COLORS = Object.freeze([
    [0.90, 0.42, 0.31],
    [0.95, 0.74, 0.30],
    [0.28, 0.55, 0.93],
    [0.30, 0.74, 0.56],
    [0.66, 0.45, 0.86],
]);

function combineTransforms(base, transient) {
    return {
        scaleX: base.scaleX * transient.scaleX,
        scaleY: base.scaleY * transient.scaleY,
        translationX: base.translationX + transient.translationX,
        translationY: base.translationY + transient.translationY,
        dim: base.dim ?? 0,
    };
}

// interpolateTransform covers the shared geometry; dim is preview-only.
function interpolateWithDim(from, to, progress) {
    const fromDim = from.dim ?? 0;
    return {
        ...interpolateTransform(from, to, progress),
        dim: fromDim + ((to.dim ?? 0) - fromDim) * progress,
    };
}

function drawIcon(cr, centerX, top, size, color, transform) {
    const radius = size * 0.28;
    // Scale dock-sized travel to the preview icons.
    const translateScale = size / REFERENCE_ICON_SIZE;
    cr.save();
    cr.translate(
        centerX + transform.translationX * translateScale,
        top + size + transform.translationY * translateScale);
    cr.scale(transform.scaleX, transform.scaleY);
    roundedRectangle(cr, -size / 2, -size, size, size, radius);
    cr.setSourceRGBA(...color, 1);
    cr.fill();
    roundedRectangle(cr, -size / 2 + 0.5, -size + 0.5, size - 1, size - 1, radius);
    cr.setSourceRGBA(1, 1, 1, 0.10);
    cr.setLineWidth(1);
    cr.stroke();
    const dim = transform.dim ?? 0;
    if (dim > 0) {
        roundedRectangle(cr, -size / 2, -size, size, size, radius);
        cr.setSourceRGBA(0, 0, 0, dim);
        cr.fill();
    }
    cr.restore();
}

function roundedRectangle(cr, x, y, width, height, radius) {
    const right = x + width;
    const bottom = y + height;
    cr.newSubPath();
    cr.arc(right - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(right - radius, bottom - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, bottom - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
    cr.closePath();
}
