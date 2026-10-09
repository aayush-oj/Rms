#!/usr/bin/env node
const fs=require('node:fs'); const path=require('node:path'); const {execSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'); const out=path.join(root,'release-packages'); fs.rmSync(out,{recursive:true,force:true}); fs.mkdirSync(out,{recursive:true});
const archive=path.join(out,'restrox-rebuild-01-42.tar.gz');
const cmd=`tar -C ${JSON.stringify(root)} --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --exclude=release-packages --exclude=.git -cf - . | gzip -n -c > ${JSON.stringify(archive)}`;
execSync(cmd,{stdio:'inherit',shell:'/bin/bash'}); console.log(archive);
