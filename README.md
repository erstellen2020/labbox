# linux红帽教程-labbox实验盒子

一个能基于vmware自动创建实验环境，检测代码执行结果的软件教学平台。

## 初衷

六七年运维运维老人了，深知linux学习过程过于枯燥，因此想着做一个教程实验一体的一个小软件。网络上教程和实际操作大多数是分离的，环境不一，资料不全，关键步骤是否执行成功也无法得知，导致进展不下去。

很多伙伴不是没有学习的动力，是学习前的准备工作太多了，就像一个学习炒菜的人，如果需要出门买菜、砍价、洗菜，浪费太多的时间在前置工作上，做这个软件的目的，是让你先把时间花在炒菜上面，前置步骤可以后面慢慢学。

你需要做什么，把vmware软件安装好，ova文件准备好，导入下实验文件，就可以开始学习了。（说明书都有教程）

linux教程方面，属红帽最为知名，因此配套课程以红帽作为编写模板，对其进行必要的补充和修改，学不会就真是我写的有问题了，无AI，放心食用。

核心辅助：针对关键步骤做了检测判断，可以辅助你查看命令是否执行成功。

环境重置：一键重置实验环境，新手要的是先成功，而不是排错。能力不足时，重新开始会更好，排错是等你学会后，再来折腾。

虚拟机资源调度：如果你平日里经常折腾vm，需要创建集群环境之类的，软件也支持自定义资源，直接帮你创建好虚拟机，不需要你手动点开vm，一台台创建操作。



## 软件介绍

### 课程导入

软件依赖于实验手册，导入实验手册后就能看得到课程，具体操作在说明中有写。

![image-20260417204112892](https://create1997linxudo.oss-cn-guangzhou.aliyuncs.com/file/image-20260417204112892.png)



### 实验区域

左侧功能菜单，中间实验手册，右侧ssh资源，ssh资源基于vmare自行创建，自动连接实验手册对应的虚拟机资源。

![image-20260417204214868](https://create1997linxudo.oss-cn-guangzhou.aliyuncs.com/file/image-20260417204214868.png)



### 环境重置

环境弄坏了，点击左侧“环境重置即可”，基于快照机制，10秒崭新如初。中间实验手册，目前展示的内容基于红帽编写，（累啊）纯手工制作，右侧是实验手册对应的ssh资源。



### 实验步骤检测

实验手册针对当前必要的步骤进行检测，辅助确认命令有效执行。

未通过：

![image-20260417215111050](https://create1997linxudo.oss-cn-guangzhou.aliyuncs.com/file/image-20260417215111050.png)

通过：

![image-20260417215123315](https://create1997linxudo.oss-cn-guangzhou.aliyuncs.com/file/image-20260417215123315.png)

### 实验文件一键导入

如果实验手册绑定文件（任意类型），支持一键导入，避免实验中缺失素材。

![image-20260417220514931](https://create1997linxudo.oss-cn-guangzhou.aliyuncs.com/file/image-20260417220514931.png)



### 资源自定义

除了实验手册定义的资源，可自行定义虚拟机。

在首页中新建课程，课程中新建目录，然后即可创建实验，在实验中，可自行添加实验资源。

![image-20260417212953393](https://create1997linxudo.oss-cn-guangzhou.aliyuncs.com/file/image-20260417212953393.png)



假设说你需要弄个集群，可根据个人需要创建虚拟机，只要你本地资源就行。

![image-20260417215307223](https://create1997linxudo.oss-cn-guangzhou.aliyuncs.com/file/image-20260417215307223.png)

此处演示创建三台虚拟机。

![image-20260417213048149](https://create1997linxudo.oss-cn-guangzhou.aliyuncs.com/file/image-20260417213048149.png)

### 虚拟机管理

可自行管理课程所创建的虚拟机。

![image-20260417213217709](https://create1997linxudo.oss-cn-guangzhou.aliyuncs.com/file/image-20260417213217709.png)

其他介绍在说明数中，可前往查看。

## 软件安装
npm start，依赖npm环境。
下面是打包好的，超过100M，github无法上传。
链接: https://pan.baidu.com/s/1l5PtiP-e9LmixzB0NBYvkA 提取码: p8mh
