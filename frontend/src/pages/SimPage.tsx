import {useEffect, useRef, useState} from "react"
import {actInfer, getCarState, resetCar, sendAction, socket} from "../api/socket";
import type {Car} from "../model/car";
import {checkCollision} from "../model/target";
import {useTargetStore} from "../store/targetStore";
import {
    MAP_W,
    MAP_H,
    renderTopDownTargets,
    targetsToWalls,
    computeSprites,
    renderFirstPersonWalls,
    renderFirstPersonSprites
} from "../components/target/TargetRenderer";
import {TargetManager} from "../components/target/TargetManager";
import { useTargetCreation } from "../components/target/useTargetCreation";
import { useTargetDrag } from "../components/target/useTargetDrag";
import ThreeSimulator from "../components/three/ThreeSimulator";




const INITIAL_LOCAL_W = MAP_W / 2;
const INITIAL_LOCAL_H = MAP_H / 2;

const FPS = 20
const frameInterval = 1000 / FPS

const SimPage = () => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const fpvRef = useRef<HTMLCanvasElement | null>(null);

    const { targets, updateTarget, removeTarget, selectTarget, selectedTargetId } = useTargetStore();
    const [is3DMode, setIs3DMode] = useState(false);


    const targetsRef = useRef(targets);

    useEffect(() => {
        targetsRef.current = targets;
    }, [targets]);

    useEffect(() => {
        if (!is3DMode) {
            // 切换回2D模式时，将焦点设置到body，确保全局键盘监听器工作
            document.body.focus();
            // 清空可能残留的键状态
            keys.current = {};
        } else {
            // 切换到3D模式时，也清空键状态
            keys.current = {};
        }
    }, [is3DMode]);



    const {
        selectedTargetType,
        setSelectedTargetType,
        isCreatingTarget,
        setIsCreatingTarget,
        createTarget
    } = useTargetCreation();

    useTargetDrag({
        canvasRef,
        targetsRef,
        updateTarget,
        selectTarget,
        isCreatingTarget,
        createTarget
    });



    const carState = useRef({
        x: 400,
        y: 300,
        angle: -Math.PI / 2,
    })
    const [_carStateDisplay, setCarStateDisplay] = useState({
        x: 400,
        y: 300,
        angle: -Math.PI / 2,
    })
    const [actEnabled, setActEnabled] = useState(false)
    const [actStatus, setActStatus] = useState("ACT: off")
    const actCommandRef = useRef<string>("stop")

    const handleCreateTargetInFront = () => {
        const {x, y, angle} = carState.current;
        const frontX = x + Math.cos(angle) * 50;
        const frontY = y + Math.sin(angle) * 50;
        createTarget(frontX, frontY);
    };

    useEffect(() => {
        getCarState()
        socket.on('car_state', (car: Car) => {
            const newState = {
                x: car.x + INITIAL_LOCAL_W,
                y: car.y + INITIAL_LOCAL_H,
                angle: car.angle
            };
            carState.current = newState;
            setCarStateDisplay(newState);
        });
        socket.on('act_action', (payload: {action?: number[][][]; error?: string}) => {
            if (payload?.error) {
                setActStatus(`ACT: ${payload.error}`)
                actCommandRef.current = "stop"
                return
            }
            const action = payload?.action
            if (!action || action.length === 0 || action[0].length === 0) {
                setActStatus("ACT: empty")
                actCommandRef.current = "stop"
                return
            }
            const cmd = mapActionToCommand(action[0][0])
            actCommandRef.current = cmd
            setActStatus(`ACT: ${cmd}`)
        })
        return () => {
            socket.off('car_state');
            socket.off('act_action');
        }
    }, [])

    const keys = useRef<Record<string, boolean>>({})
    const is3DModeRef = useRef(is3DMode);

    useEffect(() => {
        is3DModeRef.current = is3DMode;
    }, [is3DMode]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const updatePhysics = () => {
        console.log('updatePhysics called, is3DMode:', is3DModeRef.current, 'actEnabled:', actEnabled);
        console.log('keys state:', {
            ArrowUp: keys.current['ArrowUp'],
            KeyW: keys.current['KeyW'],
            ArrowDown: keys.current['ArrowDown'],
            KeyS: keys.current['KeyS'],
            ArrowLeft: keys.current['ArrowLeft'],
            KeyA: keys.current['KeyA'],
            ArrowRight: keys.current['ArrowRight'],
            KeyD: keys.current['KeyD']
        });
        
        if (actEnabled) {
            sendAction(actCommandRef.current)
            const state = carState.current
            if (checkCollision(state.x, state.y, MAP_W, MAP_H, targetsRef.current)) {
                sendAction("stop")
            }
            return
        }
        if (keys.current['ArrowUp'] || keys.current['KeyW']) {
            console.log('Sending up action');
            sendAction("up")
        }
        if (keys.current['ArrowDown'] || keys.current['KeyS']) {
            console.log('Sending down action');
            sendAction("down")
        }
        if (keys.current['ArrowLeft'] || keys.current['KeyA']) {
            console.log('Sending left action');
            sendAction("left")
        }
        if (keys.current['ArrowRight'] || keys.current['KeyD']) {
            console.log('Sending right action');
            sendAction("right")
        }

        if (selectedTargetId) {
            if (keys.current['KeyQ']) {
                const target = targets.find(t => t.id === selectedTargetId);
                if (target && target.type === 'RECT') {
                    const currentAngle = target.angle || 0;
                    updateTarget(selectedTargetId, { angle: currentAngle - 0.05 });
                }
            }
            if (keys.current['KeyE']) {
                const target = targets.find(t => t.id === selectedTargetId);
                if (target && target.type === 'RECT') {
                    const currentAngle = target.angle || 0;
                    updateTarget(selectedTargetId, { angle: currentAngle + 0.05 });
                }
            }
            if (keys.current['Delete']) {
                removeTarget(selectedTargetId);
                selectTarget(null);
            }
        }

        const state = carState.current;
        if (checkCollision(state.x, state.y, MAP_W, MAP_H, targetsRef.current)) {
            sendAction("stop")
        }
    }




    const buildObservation = () => {
        const {x, y, angle} = carState.current
        const state = new Array(14).fill(0)
        state[0] = x
        state[1] = y
        state[2] = angle
        const envState = [x, y, angle, 0, 0, 0]
        return {observation: {state, environment_state: envState}}
    }

    const mapActionToCommand = (vec: number[]) => {
        if (!Array.isArray(vec) || vec.length === 0) return "stop"
        const v0 = vec[0] ?? 0
        const v1 = vec[1] ?? 0
        const magnitude = Math.abs(v0) + Math.abs(v1)
        if (magnitude < 0.1) return "stop"
        if (Math.abs(v0) >= Math.abs(v1)) {
            return v0 >= 0 ? "up" : "down"
        }
        return v1 >= 0 ? "right" : "left"
    }

    const drawGrid = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        ctx.strokeStyle = '#e0e0e0'
        ctx.lineWidth = 1
        const gridSize = 50

        ctx.beginPath()
        for (let x = 0; x <= w; x += gridSize) {
            ctx.moveTo(x, 0)
            ctx.lineTo(x, h)
        }
        for (let y = 0; y <= h; y += gridSize) {
            ctx.moveTo(0, y)
            ctx.lineTo(w, y)
        }
        ctx.stroke()
    }

    const drawCarBody = (ctx: CanvasRenderingContext2D) => {
        const {x, y, angle} = carState.current;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = 'blue';
        ctx.fillRect(-20, -10, 40, 20);
        ctx.fillStyle = 'yellow';
        ctx.beginPath();
        ctx.arc(15, -6, 3, 0, Math.PI * 2);
        ctx.arc(15, 6, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2c3e50'
        ctx.fillRect(5, -8, 10, 16)
        ctx.restore();
    }

    const drawTopDown = (ctx: CanvasRenderingContext2D) => {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

        drawGrid(ctx, ctx.canvas.width, ctx.canvas.height)

        ctx.save()

        renderTopDownTargets(ctx, targetsRef.current, selectedTargetId);

        drawCarBody(ctx)

        const {x, y, angle} = carState.current;
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle - Math.PI / 6) * 100, y + Math.sin(angle - Math.PI / 6) * 100);
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle + Math.PI / 6) * 100, y + Math.sin(angle + Math.PI / 6) * 100);
        ctx.stroke();

        ctx.restore()
    }




    const drawFirstPerson = (ctx: CanvasRenderingContext2D) => {
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const {x, y, angle} = carState.current;

        ctx.fillStyle = '#87CEEB';
        ctx.fillRect(0, 0, w, h / 2);
        ctx.fillStyle = '#7f8c8d';
        ctx.fillRect(0, h / 2, w, h / 2);

        const fov = Math.PI / 3;
        const rayCount = w / 4;
        const rayWidth = w / rayCount;

        const walls = targetsToWalls(targetsRef.current);

        const depthBuffer = renderFirstPersonWalls(ctx, walls, x, y, angle, w, h);

        const sprites = computeSprites(targetsRef.current, x, y, angle, fov, w, h);

        renderFirstPersonSprites(ctx, sprites, depthBuffer, rayWidth, rayCount, x, y, angle, fov);
    }


    useEffect(() => {
        let animationFrameId: number;
        let lastTime = 0;

        const physicsLoop = (currentTime: number) => {
            animationFrameId = window.requestAnimationFrame(physicsLoop);

            // 3D模式下停止物理循环
            if (is3DModeRef.current) {
                return;
            }

            const delta = currentTime - lastTime;
            if (delta < frameInterval) return;
            lastTime = currentTime - (delta % frameInterval);

            if (actEnabled) {
                actInfer(buildObservation());
            }
            updatePhysics();
        };

        animationFrameId = window.requestAnimationFrame(physicsLoop);

        return () => {
            window.cancelAnimationFrame(animationFrameId);
        };
    }, [actEnabled, updatePhysics, is3DMode]);

    // 键盘事件监听 - 始终运行（使用捕获阶段确保无论焦点在哪都能捕获）
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            console.log('SimPage keydown (capture):', e.code, 'is3DMode:', is3DModeRef.current, 'target:', e.target);
            keys.current[e.code] = true;
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            console.log('SimPage keyup (capture):', e.code, 'is3DMode:', is3DModeRef.current, 'target:', e.target);
            keys.current[e.code] = false;
        };

        // 使用捕获阶段，确保无论焦点在哪都能捕获键盘事件
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('keyup', handleKeyUp, true);

        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('keyup', handleKeyUp, true);
        };
    }, []);

    useEffect(() => {
        if (is3DMode) return;

        const canvas = canvasRef.current;
        const fpv = fpvRef.current;
        if (canvas == null || fpv == null) return;
        const ctxTop = canvas.getContext('2d');
        const ctxFpv = fpv.getContext('2d');

        if (ctxTop == null || ctxFpv == null) return;

        ctxFpv.imageSmoothingEnabled = false;

        let animationFrameId: number;
        let lastTime = 0;

        const renderLoop = (currentTime: number) => {
            animationFrameId = window.requestAnimationFrame(renderLoop);

            const delta = currentTime - lastTime;

            if (delta < frameInterval) return;

            lastTime = currentTime - (delta % frameInterval);

            drawTopDown(ctxTop);
            drawFirstPerson(ctxFpv);
        };

        animationFrameId = window.requestAnimationFrame(renderLoop);

        return () => {
            window.cancelAnimationFrame(animationFrameId);
        };
    }, [is3DMode, drawTopDown, drawFirstPerson]);

    const sendCommand = (cmd: string) => {
        keys.current[cmd] = true
        setTimeout(() => {
            keys.current[cmd] = false
        }, 200)
    }

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            padding: '20px',
            height: '100vh',
            boxSizing: 'border-box',
            overflow: 'hidden'
        }}>
            <h1 style={{textAlign: 'center'}}>小车模拟器</h1>
            <div style={{
                display: 'flex',
                flexDirection: 'row',
                gap: '20px',
                flex: 1
            }}>
                <div style={{
                    flex: '0 0 20%',
                    minWidth: '250px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px'
                }}>
                    <TargetManager
                        onCreateInFront={handleCreateTargetInFront}
                        isCreatingTarget={isCreatingTarget}
                        onToggleCreating={setIsCreatingTarget}
                        selectedTargetType={selectedTargetType}
                        onTargetTypeChange={setSelectedTargetType}
                    />
                </div>


                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    alignItems: 'center'
                }}>
                    <div style={{display: 'flex', flexDirection: 'row', gap: '20px'}}>
                        {is3DMode ? (
                            <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px'}}>
                                <div style={{position: 'relative', border: '2px solid #333'}}>
                                    <ThreeSimulator
                                        targets={targets}
                                        width={800}
                                        height={600}
                                        selectedTargetId={selectedTargetId}
                                        onTargetSelect={selectTarget}
                                        onTargetUpdate={updateTarget}
                                    />
                                </div>
                                <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center'}}>
                                    <button onClick={() => setIs3DMode(false)}>切换到2D模式</button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px'}}>
                                    <div style={{position: 'relative', border: '2px solid #333'}}>
                                        <canvas
                                            ref={canvasRef}
                                            width={800}
                                            height={600}
                                            style={{background: '#f9f9f9', display: 'block'}}
                                        />
                                        <div style={{
                                            position: 'absolute',
                                            top: 10,
                                            left: 10,
                                            background: 'rgba(255,255,255,0.8)',
                                            padding: 5
                                        }}>
                                            使用 WASD 或 方向键 移动<br/>
                                            使用 QE 键旋转选中的目标物<br/>
                                            选中目标物后按 Delete 键删除
                                        </div>
                                    </div>

                                    <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center'}}>
                                        <button onClick={() => sendCommand('ArrowUp')}>指令: 前进</button>
                                        <button onClick={() => sendCommand('ArrowLeft')}>指令: 左转</button>
                                        <button onClick={() => sendCommand('ArrowRight')}>指令: 右转</button>
                                        <button onClick={() => sendCommand('ArrowDown')}>指令: 后退</button>
                                        <button onClick={resetCar}>重置 (Reset)</button>
                                        <button onClick={() => setActEnabled(v => !v)}>切换 ACT</button>
                                        <button onClick={() => setIs3DMode(true)}>切换到3D模式</button>
                                    </div>
                            <div style={{marginTop: 8, fontSize: 12, opacity: 0.8}}>
                                {actStatus}
                                    </div>
                                </div>
                                <div style={{position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                                    <div style={{
                                        position: 'absolute',
                                        top: 5,
                                        left: 5,
                                        background: 'rgba(255,255,255,0.7)',
                                        padding: '2px 5px',
                                        fontSize: '12px'
                                    }}>车载摄像头 (Camera)
                                    </div>
                                    <canvas ref={fpvRef} width={320} height={240}
                                            style={{background: '#000', border: '4px solid #333'}}/>
                                    <div style={{marginTop: '10px', fontSize: '14px', color: '#555', width: 320}}>
                                        说明：右侧画面是根据左侧地图实时计算生成的伪3D视角。
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>


        </div>
    )
}

export default SimPage
