# lamp

## Create stack

aws cloudformation create-stack --stack-name LampStack --template-body file://infra.json

## Update stack

aws cloudformation update-stack --stack-name LampStack --template-body file://infra.json

## Delete stack

aws cloudformation delete-stack --stack-name LampStack

## Setup Instance
sudo yum update -y
sudo amazon-linux-extras install -y php7.2
sudo yum install -y httpd   
sudo systemctl start httpd
sudo systemctl enable httpd
sudo usermod -a -G apache ec2-user
exit
sudo chown -R ec2-user:apache /var/www
sudo chmod 2775 /var/www && find /var/www -type d -exec sudo chmod 2775 {} \;
find /var/www -type f -exec sudo chmod 0664 {} \;
echo "<html><body>I'am OK</body></html>" > /var/www/html/health.html
echo "<html><body>This is some content</body></html>" > /var/www/html/index.html

## Create AMI

aws ec2 create-image --instance-id i-0ece45cccf5b6a991 --name AMILamp