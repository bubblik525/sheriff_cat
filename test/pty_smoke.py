import os,pty,subprocess,fcntl,termios,struct,time,select,json,tempfile,shutil
from pathlib import Path
root=Path(__file__).resolve().parents[1]
folder=tempfile.mkdtemp(prefix='sheriff-pty-')
master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',38,120,0,0))
p=subprocess.Popen([shutil.which('node'),str(root/'bin/sheriff.mjs'),'--demo','--data-dir',folder],stdin=slave,stdout=slave,stderr=slave,start_new_session=True);os.close(slave)
output=b''
def pump(seconds):
 global output
 end=time.time()+seconds
 while time.time()<end:
  if select.select([master],[],[],.05)[0]:
   try:output+=os.read(master,65536)
   except OSError:break
try:
 pump(.4)
 for key in [b'w',b'3',b'4',b'5',b'1',b'/MOON\r',b'/\x15\r',b'd0x0000000000000000000000000000000000000001\r',b'2',b'1',b'\x1b[B',b'6',b'u',b'7',b'e',b'1',b'\r',b'\x1b[B',b'\x1b',b'?',b'\x1b',b'p',b'p',b'1',b'\x1b[B',b':alert liquidity>100\r',b':paper 100 10 20 30 50\r',b'8',b'\x1b[C',b'\x1b[C',b':wallet 0x0000000000000000000000000000000000000064\r',b':size 100 30 50\r',b'\x1b',b'q']:
  os.write(master,key);pump(.15)
 p.wait(timeout=5)
 state=json.load(open(folder+'/demo.json'))
 assert p.returncode==0
 assert len(state['trading']['rules'])==1
 assert len(state['trading']['paper'])==1
 assert state['trading']['paper'][0]['address'].endswith('2')
 assert state['trading']['balance']==9900
 assert len(state['trading']['wallets'])==1
 assert len(state['watch'])==1
 assert len(state['games'])==1
 assert state['games'][0]['address'].endswith('2')
 assert any(n.endswith('.txt') for n in os.listdir(folder))
 assert not os.path.exists(folder+'/demo.json.lock')
 assert b'\x1b[?25h' in output and b'\x1b[?1049l' in output
 assert b'DEMO' in output
 print(json.dumps({'exit':p.returncode,'watch_saved':True,'selected_prediction_saved':True,'daily_exported':True,'terminal_restored':True,'lock_released':True,'research_rule_saved':True,'paper_position_saved':True,'public_address_saved':True}))
finally:
 if p.poll() is None:p.kill();p.wait()
 os.close(master);shutil.rmtree(folder)
